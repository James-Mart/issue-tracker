import {
  commentEditSchema,
  formatZodError,
  type Comment,
  type CommentAnchor,
  type CommentEdit,
  type CommentInput,
  type CommentSource,
} from "../schemas.js";
import { appendComment, appendCommentLogRecords, readComments } from "./comment-append.js";
import { isFullCommitSha } from "./commit-sha.js";
import { parseGhGraphqlRepository, parsePrUrl, runGh } from "./delivery.js";
import { IssueError } from "./errors.js";
import { requireKindCapability, serialize } from "./issues.js";
import { requireProjectWorkspace } from "./project-workspace.js";
import type { PrSyncStepResult } from "./pr-sync-driver.js";

const PAGE_SIZE = 100;

const ACTOR_FIELDS = "author { __typename login }";

const COMMENT_FIELDS = `
          id
          url
          body
          createdAt
          updatedAt
          ${ACTOR_FIELDS}`;

const REVIEW_FIELDS = `
          id
          url
          body
          state
          submittedAt
          updatedAt
          ${ACTOR_FIELDS}`;

const REVIEW_COMMENT_FIELDS = `
              id
              url
              body
              createdAt
              updatedAt
              state
              ${ACTOR_FIELDS}
              commit { oid }
              originalCommit { oid }
              replyTo { id }`;

/**
 * A comment input mirrored from GitHub. `replyToSourceId` names the parent
 * GitHub node id for a review reply. `createdAt` is the GitHub time stamped
 * onto the tracker comment as `at` — a review summary uses `submittedAt`.
 */
export type MirroredComment = CommentInput & {
  source: CommentSource;
  replyToSourceId?: string;
  createdAt: string;
};

/**
 * A GitHub comment whose updated time is after its created time (submitted
 * time for a review summary). The mirror step writes a `comment-edit` only
 * when `body` differs from the tracker copy's current body.
 */
export type MirroredEdit = {
  sourceId: string;
  body: string;
  editedAt: string;
};

type MappedComment = {
  comment: MirroredComment;
  edit?: MirroredEdit;
};

export type PrCommentFetch = {
  comments: MirroredComment[];
  edits: MirroredEdit[];
};

const cursors = new Map<string, string>();

/** @internal Drop per-PR fetch cursors between tests. */
export function resetPrCommentMirrorForTests(): void {
  cursors.clear();
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new IssueError("gh-failed", `gh graphql returned an unexpected ${what}`);
  }
  return value as Record<string, unknown>;
}

function githubTime(value: unknown, label: string): { iso: string; ms: number } {
  if (typeof value !== "string") {
    throw new IssueError(
      "gh-failed",
      `gh graphql returned a comment without ${label}`,
    );
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new IssueError(
      "gh-failed",
      `gh graphql returned an unreadable comment ${label}`,
    );
  }
  return { iso: new Date(ms).toISOString(), ms };
}

function sinceMs(since: string): number {
  const ms = Date.parse(since);
  if (Number.isNaN(ms)) {
    throw new IssueError("validation", `since is not a timestamp: ${since}`);
  }
  return ms;
}

/**
 * Human authors are GitHub users. Bots land as `github-bot`. Other actors
 * (a deleted account, an organization) have no role here. A blank body is
 * not a tracker comment.
 */
function mapAuthor(
  author: unknown,
): { role: "human" | "github-bot"; name: string } | null {
  if (author == null) return null;
  const record = asRecord(author, "comment author");
  if (typeof record.login !== "string" || record.login.length === 0) return null;
  if (record.__typename === "User") return { role: "human", name: record.login };
  if (record.__typename === "Bot") return { role: "github-bot", name: record.login };
  return null;
}

function replyToSourceIdOf(record: Record<string, unknown>): string | undefined {
  if (!("replyTo" in record) || record.replyTo == null) return undefined;
  const reply = asRecord(record.replyTo, "review comment reply");
  if (typeof reply.id !== "string" || reply.id.length === 0) {
    throw new IssueError(
      "gh-failed",
      "gh graphql returned a review comment reply without an id",
    );
  }
  return reply.id;
}

/**
 * `onOld` is `stop` for conversation comments, which GitHub can order by
 * updated time. Reviews and review threads have no such order, so an old
 * row is skipped and paging continues.
 * Review summaries pass `submittedAt` — that is when the summary was published.
 */
function mapComment(
  node: unknown,
  cutoffMs: number | undefined,
  onOld: "stop",
  createdField?: "createdAt",
): MappedComment | "stop" | null;
function mapComment(
  node: unknown,
  cutoffMs: number | undefined,
  onOld: "skip",
  createdField?: "createdAt" | "submittedAt",
): MappedComment | null;
function mapComment(
  node: unknown,
  cutoffMs: number | undefined,
  onOld: "stop" | "skip",
  createdField: "createdAt" | "submittedAt" = "createdAt",
): MappedComment | "stop" | null {
  if (node == null) return null;
  const record = asRecord(node, "comment");
  if (record.state === "PENDING") return null;
  const updated = githubTime(record.updatedAt, "updatedAt");
  if (cutoffMs !== undefined && updated.ms < cutoffMs) {
    return onOld === "stop" ? "stop" : null;
  }
  const author = mapAuthor(record.author);
  if (!author) return null;
  if (typeof record.body !== "string") {
    throw new IssueError("gh-failed", "gh graphql returned a comment without a body");
  }
  if (record.body.length === 0) return null;
  if (typeof record.id !== "string" || record.id.length === 0) {
    throw new IssueError("gh-failed", "gh graphql returned a comment without an id");
  }
  if (typeof record.url !== "string" || record.url.length === 0) {
    throw new IssueError("gh-failed", "gh graphql returned a comment without a url");
  }
  const created = githubTime(record[createdField], createdField);
  const replyToSourceId = replyToSourceIdOf(record);
  const edit =
    updated.ms > created.ms
      ? { sourceId: record.id, body: record.body, editedAt: updated.iso }
      : undefined;
  return {
    comment: {
      role: author.role,
      name: author.name,
      body: record.body,
      createdAt: created.iso,
      source: { kind: "github", id: record.id, url: record.url },
      ...(replyToSourceId ? { replyToSourceId } : {}),
    },
    ...(edit ? { edit } : {}),
  };
}

function collectMapped(
  mapped: MappedComment | null,
  comments: MirroredComment[],
  edits: MirroredEdit[],
): void {
  if (!mapped) return;
  comments.push(mapped.comment);
  if (mapped.edit) edits.push(mapped.edit);
}

function commentsQuery(
  owner: string,
  repo: string,
  number: number,
  cursor: string | null,
  since: boolean,
): string {
  const field = since ? "UPDATED_AT" : "CREATED_AT";
  const direction = since ? "DESC" : "ASC";
  const after = cursor ? `, after: ${JSON.stringify(cursor)}` : "";
  return `query {
  repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(repo)}) {
    pullRequest(number: ${number}) {
      comments(first: ${PAGE_SIZE}, orderBy: {field: ${field}, direction: ${direction}}${after}) {
        pageInfo { hasNextPage endCursor }
        nodes {${COMMENT_FIELDS}
        }
      }
    }
  }
}`;
}

function reviewsQuery(
  owner: string,
  repo: string,
  number: number,
  cursor: string | null,
): string {
  const after = cursor ? `, after: ${JSON.stringify(cursor)}` : "";
  return `query {
  repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(repo)}) {
    pullRequest(number: ${number}) {
      reviews(first: ${PAGE_SIZE}${after}) {
        pageInfo { hasNextPage endCursor }
        nodes {${REVIEW_FIELDS}
        }
      }
    }
  }
}`;
}

function reviewThreadsQuery(
  owner: string,
  repo: string,
  number: number,
  cursor: string | null,
): string {
  const after = cursor ? `, after: ${JSON.stringify(cursor)}` : "";
  return `query {
  repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(repo)}) {
    pullRequest(number: ${number}) {
      reviewThreads(first: ${PAGE_SIZE}${after}) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          path
          line
          originalLine
          startLine
          originalStartLine
          diffSide
          subjectType
          comments(first: ${PAGE_SIZE}) {
            pageInfo { hasNextPage endCursor }
            nodes {${REVIEW_COMMENT_FIELDS}
            }
          }
        }
      }
    }
  }
}`;
}

function threadCommentsQuery(threadId: string, cursor: string): string {
  return `query {
  node(id: ${JSON.stringify(threadId)}) {
    ... on PullRequestReviewThread {
      comments(first: ${PAGE_SIZE}, after: ${JSON.stringify(cursor)}) {
        pageInfo { hasNextPage endCursor }
        nodes {${REVIEW_COMMENT_FIELDS}
        }
      }
    }
  }
}`;
}

type ConnectionPage = {
  nodes: unknown[];
  hasNextPage: boolean;
  endCursor: string | null;
};

function readConnection(connection: unknown, label: string): ConnectionPage {
  const record = asRecord(connection, label);
  const nodes = record.nodes;
  if (!Array.isArray(nodes)) {
    throw new IssueError("gh-failed", `gh graphql returned an unexpected ${label}`);
  }
  const pageInfo = asRecord(record.pageInfo, label);
  if (typeof pageInfo.hasNextPage !== "boolean") {
    throw new IssueError("gh-failed", `gh graphql returned an unexpected ${label}`);
  }
  const endCursor = pageInfo.endCursor;
  if (endCursor != null && typeof endCursor !== "string") {
    throw new IssueError("gh-failed", `gh graphql returned an unexpected ${label}`);
  }
  return {
    nodes,
    hasNextPage: pageInfo.hasNextPage,
    endCursor: endCursor ?? null,
  };
}

function pullRequestOf(stdout: string): Record<string, unknown> {
  const repository = parseGhGraphqlRepository(stdout);
  if (!repository) {
    throw new IssueError("gh-failed", "gh graphql returned no repository");
  }
  const pullRequest = repository.pullRequest;
  if (pullRequest == null) {
    throw new IssueError("gh-failed", "gh graphql returned no pull request");
  }
  return asRecord(pullRequest, "pull request");
}

async function ghGraphql(workspace: string, query: string): Promise<string> {
  return runGh(["api", "graphql", "-f", `query=${query}`], workspace);
}

async function collectPages<T>(
  workspace: string,
  queryFor: (cursor: string | null) => string,
  read: (stdout: string) => {
    items: T[];
    edits?: MirroredEdit[];
    stop: boolean;
    hasNextPage: boolean;
    endCursor: string | null;
  },
  startCursor: string | null = null,
): Promise<{ items: T[]; edits: MirroredEdit[] }> {
  const items: T[] = [];
  const edits: MirroredEdit[] = [];
  let cursor: string | null = startCursor;
  const seenCursors = new Set<string>();
  if (startCursor) seenCursors.add(startCursor);
  for (;;) {
    const page = read(await ghGraphql(workspace, queryFor(cursor)));
    items.push(...page.items);
    if (page.edits) edits.push(...page.edits);
    if (page.stop || !page.hasNextPage) break;
    if (!page.endCursor || seenCursors.has(page.endCursor)) {
      throw new IssueError(
        "gh-failed",
        "gh graphql returned a comment page without a cursor",
      );
    }
    seenCursors.add(page.endCursor);
    cursor = page.endCursor;
  }
  return { items, edits };
}

function positiveLine(value: unknown, label: string): number | undefined {
  if (value == null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new IssueError(
      "gh-failed",
      `gh graphql returned a review thread with an unreadable ${label}`,
    );
  }
  return value;
}

function commitOid(value: unknown, label: string): string {
  if (value == null) {
    throw new IssueError(
      "gh-failed",
      `gh graphql returned a review comment without ${label}`,
    );
  }
  const record = asRecord(value, label);
  if (typeof record.oid !== "string" || !isFullCommitSha(record.oid)) {
    throw new IssueError(
      "gh-failed",
      `gh graphql returned a review comment without ${label}`,
    );
  }
  return record.oid;
}

function anchorFromThread(
  thread: Record<string, unknown>,
  root: Record<string, unknown>,
): CommentAnchor {
  if (typeof thread.path !== "string" || thread.path.length === 0) {
    throw new IssueError(
      "gh-failed",
      "gh graphql returned a review thread without a path",
    );
  }
  if (thread.subjectType !== "LINE" && thread.subjectType !== "FILE") {
    throw new IssueError(
      "gh-failed",
      "gh graphql returned a review thread with an unreadable subject",
    );
  }
  const line = positiveLine(thread.line, "line");
  const useCurrent = line !== undefined;
  if (thread.subjectType === "FILE") {
    const commit = root.commit != null ? root.commit : root.originalCommit;
    return {
      path: thread.path,
      commitSha: commitOid(commit, root.commit != null ? "commit" : "originalCommit"),
    };
  }
  const anchoredLine = line ?? positiveLine(thread.originalLine, "originalLine");
  if (anchoredLine === undefined) {
    throw new IssueError(
      "gh-failed",
      "gh graphql returned a review thread without a line",
    );
  }
  if (thread.diffSide !== "LEFT" && thread.diffSide !== "RIGHT") {
    throw new IssueError(
      "gh-failed",
      "gh graphql returned a review thread without a diff side",
    );
  }
  const start = positiveLine(
    useCurrent ? thread.startLine : thread.originalStartLine,
    useCurrent ? "startLine" : "originalStartLine",
  );
  return {
    path: thread.path,
    side: thread.diffSide === "LEFT" ? "old" : "new",
    line: anchoredLine,
    ...(start !== undefined && start !== anchoredLine ? { startLine: start } : {}),
    commitSha: commitOid(
      useCurrent ? root.commit : root.originalCommit,
      useCurrent ? "commit" : "originalCommit",
    ),
  };
}

type RawThread = {
  thread: Record<string, unknown>;
  comments: unknown[];
  commentCursor: string | null;
};

function mapReviewThread(
  thread: Record<string, unknown>,
  nodes: unknown[],
  cutoffMs: number | undefined,
): PrCommentFetch {
  const mapped: {
    comment: MirroredComment;
    edit?: MirroredEdit;
    node: Record<string, unknown>;
  }[] = [];
  for (const node of nodes) {
    const result = mapComment(node, cutoffMs, "skip");
    if (result === null) continue;
    mapped.push({
      comment: result.comment,
      edit: result.edit,
      node: asRecord(node, "comment"),
    });
  }
  const root = mapped.find((entry) => entry.comment.replyToSourceId === undefined);
  const comments = root
    ? mapped.map((entry) =>
        entry.comment.source.id === root.comment.source.id
          ? { ...entry.comment, anchor: anchorFromThread(thread, root.node) }
          : entry.comment,
      )
    : mapped.map((entry) => entry.comment);
  return {
    comments,
    edits: mapped.flatMap((entry) => (entry.edit ? [entry.edit] : [])),
  };
}

function readThreadCommentPage(stdout: string): ConnectionPage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new IssueError("gh-failed", "gh graphql returned non-JSON stdout");
  }
  const data = asRecord(
    asRecord(parsed, "review thread comments").data,
    "review thread comments",
  );
  if (data.node == null) {
    throw new IssueError("gh-failed", "gh graphql returned no review thread");
  }
  const thread = asRecord(data.node, "review thread");
  return readConnection(thread.comments, "review thread comments");
}

async function remainingThreadComments(
  threadId: string,
  cursor: string,
  workspace: string,
): Promise<unknown[]> {
  const collected = await collectPages(
    workspace,
    (after) => threadCommentsQuery(threadId, after ?? cursor),
    (stdout) => {
      const connection = readThreadCommentPage(stdout);
      return { items: connection.nodes, stop: false, ...connection };
    },
    cursor,
  );
  return collected.items;
}

function mapConnectionNodes(
  nodes: unknown[],
  mapNode: (node: unknown) => MappedComment | "stop" | null,
): { comments: MirroredComment[]; edits: MirroredEdit[]; stop: boolean } {
  const comments: MirroredComment[] = [];
  const edits: MirroredEdit[] = [];
  for (const node of nodes) {
    const mapped = mapNode(node);
    if (mapped === "stop") return { comments, edits, stop: true };
    collectMapped(mapped, comments, edits);
  }
  return { comments, edits, stop: false };
}

async function fetchCommentConnection(
  workspace: string,
  queryFor: (cursor: string | null) => string,
  read: (stdout: string) => ConnectionPage,
  mapNode: (node: unknown) => MappedComment | "stop" | null,
): Promise<PrCommentFetch> {
  const collected = await collectPages(workspace, queryFor, (stdout) => {
    const connection = read(stdout);
    const mapped = mapConnectionNodes(connection.nodes, mapNode);
    return {
      items: mapped.comments,
      edits: mapped.edits,
      stop: mapped.stop,
      hasNextPage: connection.hasNextPage,
      endCursor: connection.endCursor,
    };
  });
  return { comments: collected.items, edits: collected.edits };
}

async function fetchConversation(
  owner: string,
  repo: string,
  number: number,
  cutoffMs: number | undefined,
  since: boolean,
  workspace: string,
): Promise<PrCommentFetch> {
  return fetchCommentConnection(
    workspace,
    (cursor) => commentsQuery(owner, repo, number, cursor, since),
    (stdout) => readConnection(pullRequestOf(stdout).comments, "comment page"),
    (node) => mapComment(node, cutoffMs, "stop"),
  );
}

async function fetchReviews(
  owner: string,
  repo: string,
  number: number,
  cutoffMs: number | undefined,
  workspace: string,
): Promise<PrCommentFetch> {
  return fetchCommentConnection(
    workspace,
    (cursor) => reviewsQuery(owner, repo, number, cursor),
    (stdout) => readConnection(pullRequestOf(stdout).reviews, "review page"),
    (node) => mapComment(node, cutoffMs, "skip", "submittedAt"),
  );
}

async function fetchReviewThreads(
  owner: string,
  repo: string,
  number: number,
  cutoffMs: number | undefined,
  workspace: string,
): Promise<PrCommentFetch> {
  const threads = (
    await collectPages(
      workspace,
      (cursor) => reviewThreadsQuery(owner, repo, number, cursor),
      (stdout) => {
        const connection = readConnection(
          pullRequestOf(stdout).reviewThreads,
          "review thread page",
        );
        const items: RawThread[] = [];
        for (const node of connection.nodes) {
          if (node == null) continue;
          const thread = asRecord(node, "review thread");
          if (typeof thread.id !== "string" || thread.id.length === 0) {
            throw new IssueError(
              "gh-failed",
              "gh graphql returned a review thread without an id",
            );
          }
          const comments = readConnection(thread.comments, "review thread comments");
          items.push({
            thread,
            comments: comments.nodes,
            commentCursor: comments.hasNextPage ? comments.endCursor : null,
          });
        }
        return { items, stop: false, ...connection };
      },
    )
  ).items;

  const comments: MirroredComment[] = [];
  const edits: MirroredEdit[] = [];
  for (const raw of threads) {
    const id = raw.thread.id;
    const nodes = raw.commentCursor
      ? raw.comments.concat(
          await remainingThreadComments(String(id), raw.commentCursor, workspace),
        )
      : raw.comments;
    const mapped = mapReviewThread(raw.thread, nodes, cutoffMs);
    comments.push(...mapped.comments);
    edits.push(...mapped.edits);
  }
  return { comments, edits };
}

/**
 * Conversation comments, review summaries, and inline review threads on a
 * pull request. Omit `since` for full history. With `since` (an ISO
 * timestamp), return items created or updated at or after that time.
 * Conversation comments stop once a page is older than `since`. Review
 * summaries and threads have no updated-at order, so those connections are
 * paged in full and filtered. `edits` are comments whose GitHub updated time
 * is after the created time, or the submitted time for a review summary.
 */
export async function fetchPrComments(
  prUrl: string,
  since: string | undefined,
  workspace: string,
): Promise<PrCommentFetch> {
  const { owner, repo, number } = parsePrUrl(prUrl);
  const cutoffMs = since === undefined ? undefined : sinceMs(since);
  const sinceSet = since !== undefined;
  const conversation = await fetchConversation(
    owner,
    repo,
    number,
    cutoffMs,
    sinceSet,
    workspace,
  );
  const reviews = await fetchReviews(owner, repo, number, cutoffMs, workspace);
  const threads = await fetchReviewThreads(owner, repo, number, cutoffMs, workspace);
  const comments = [
    ...conversation.comments,
    ...reviews.comments,
    ...threads.comments,
  ];
  comments.sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) ||
      a.source.id.localeCompare(b.source.id),
  );
  const edits = [...conversation.edits, ...reviews.edits, ...threads.edits];
  edits.sort(
    (a, b) =>
      a.editedAt.localeCompare(b.editedAt) || a.sourceId.localeCompare(b.sourceId),
  );
  return { comments, edits };
}

function commentInputOf(comment: MirroredComment): CommentInput {
  const {
    createdAt: _createdAt,
    replyToSourceId: _replyToSourceId,
    ...input
  } = comment;
  return input;
}

/**
 * Walk `replyToSourceId` to the thread root and return that root's tracker
 * comment id. Undefined when the parent was not mirrored (blank body, deleted
 * actor, or a pending draft) — that reply has no thread to join.
 */
function resolveReplyTo(
  sourceId: string,
  bySource: Map<string, MirroredComment>,
  storedBySource: Map<string, string>,
  messages: Comment[],
): string | undefined {
  const seen = new Set<string>();
  let current = sourceId;
  for (;;) {
    if (seen.has(current)) {
      throw new IssueError(
        "gh-failed",
        `gh graphql returned a review reply cycle at ${current}`,
      );
    }
    seen.add(current);
    const parent = bySource.get(current);
    if (parent?.replyToSourceId) {
      current = parent.replyToSourceId;
      continue;
    }
    const storedId = storedBySource.get(current);
    if (!storedId) return undefined;
    const stored = messages.find((message) => message.id === storedId);
    if (stored?.replyTo) return stored.replyTo;
    return storedId;
  }
}

async function landComment(
  storyId: string,
  comment: MirroredComment,
  replyTo: string | undefined,
  messages: Comment[],
  seen: Set<string>,
  storedBySource: Map<string, string>,
): Promise<void> {
  if (seen.has(comment.source.id)) return;
  const input = commentInputOf(comment);
  const stored = await appendComment(
    storyId,
    replyTo ? { ...input, replyTo } : input,
    { at: comment.createdAt, messages },
  );
  messages.push(stored);
  seen.add(comment.source.id);
  storedBySource.set(comment.source.id, stored.id);
}

/**
 * Append `comment-edit` records for GitHub bodies that differ from the
 * tracker copy. A source id with no tracker copy is left alone — the comment
 * lands, when it lands, with the current body. A comment GitHub no longer
 * returns is not in `edits`, so the tracker copy stays.
 */
async function applyMirroredEdits(
  storyId: string,
  edits: MirroredEdit[],
): Promise<void> {
  if (edits.length === 0) return;
  await serialize(() => {
    requireKindCapability(storyId, "comments");
    const current = new Map<
      string,
      { id: string; body: string; role: string; name?: string }
    >();
    for (const message of readComments(storyId).messages) {
      if (!message.source) continue;
      current.set(message.source.id, {
        id: message.id,
        body: message.body,
        role: message.role,
        name: message.name,
      });
    }
    const records: CommentEdit[] = [];
    for (const edit of edits) {
      const stored = current.get(edit.sourceId);
      if (!stored || stored.body === edit.body) continue;
      const parsed = commentEditSchema.safeParse({
        type: "comment-edit",
        commentId: stored.id,
        body: edit.body,
        at: edit.editedAt,
        role: stored.role,
        ...(stored.name !== undefined ? { name: stored.name } : {}),
      });
      if (!parsed.success) {
        throw new IssueError(
          "validation",
          formatZodError(parsed.error, "invalid mirrored comment edit"),
        );
      }
      records.push(parsed.data);
      stored.body = edit.body;
    }
    if (records.length > 0) appendCommentLogRecords(storyId, records);
  });
}

async function mirrorStoryComments(
  storyId: string,
  prUrl: string,
  workspace: string,
): Promise<void> {
  const startedAt = new Date().toISOString();
  const since = cursors.get(prUrl);
  const { comments, edits } = await fetchPrComments(prUrl, since, workspace);
  const messages = readComments(storyId).messages;
  const seen = new Set(
    messages.flatMap((message) => (message.source ? [message.source.id] : [])),
  );
  const bySource = new Map(comments.map((comment) => [comment.source.id, comment]));
  const storedBySource = new Map(
    messages.flatMap((message) =>
      message.source ? [[message.source.id, message.id] as const] : [],
    ),
  );
  const roots = comments.filter((comment) => comment.replyToSourceId === undefined);
  const replies = comments.filter(
    (comment): comment is MirroredComment & { replyToSourceId: string } =>
      comment.replyToSourceId !== undefined,
  );
  for (const comment of roots) {
    await landComment(storyId, comment, undefined, messages, seen, storedBySource);
  }
  for (const comment of replies) {
    const replyTo = resolveReplyTo(
      comment.replyToSourceId,
      bySource,
      storedBySource,
      messages,
    );
    if (!replyTo) continue;
    await landComment(storyId, comment, replyTo, messages, seen, storedBySource);
  }
  await applyMirroredEdits(storyId, edits);
  cursors.set(prUrl, startedAt);
}

/**
 * Sync-pass step after PR reconcile. Lands conversation comments, review
 * summaries, and inline review threads on each matched Story, including bot
 * authors, then appends a `comment-edit` when a fetched body differs from
 * the tracker copy. A comment GitHub no longer returns stays. The first pass
 * for a PR in this process fetches full history; later passes fetch items
 * updated since that pass.
 */
export async function mirrorPrComments(
  projectId: string,
  previous: PrSyncStepResult,
): Promise<PrSyncStepResult> {
  if (previous.matches.size === 0) return previous;
  let workspace: string;
  try {
    workspace = requireProjectWorkspace(projectId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ...previous, error: message };
  }
  for (const [storyId, prUrl] of previous.matches) {
    try {
      await mirrorStoryComments(storyId, prUrl, workspace);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ...previous, error: `${storyId}: ${message}` };
    }
  }
  return previous;
}
