import type { CommentInput, CommentSource } from "../schemas.js";
import { appendComment, readComments } from "./comment-append.js";
import { parseGhGraphqlRepository, parsePrUrl, runGh } from "./delivery.js";
import { IssueError } from "./errors.js";
import { requireProjectWorkspace } from "./project-workspace.js";
import type { PrSyncStepResult } from "./pr-sync-driver.js";

const PAGE_SIZE = 100;

/**
 * A comment input mirrored from GitHub. `replyToSourceId` names the parent
 * GitHub node id for a reply; conversation comments leave it unset.
 * `createdAt` is the GitHub created time, stamped onto the tracker comment
 * as `at`.
 */
export type MirroredComment = CommentInput & {
  source: CommentSource;
  replyToSourceId?: string;
  createdAt: string;
};

/** A later edit of a mirrored comment. This task always returns an empty list. */
export type MirroredEdit = {
  sourceId: string;
  body: string;
  editedAt: string;
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
 * Human authors are GitHub users. Bots stay in the result for the review
 * step; other actors (a deleted account, an organization) have no role here.
 * A blank body is not a tracker comment.
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

function mapComment(node: unknown, cutoffMs: number | undefined): MirroredComment | "stop" | null {
  if (node == null) return null;
  const record = asRecord(node, "comment");
  const updated = githubTime(record.updatedAt, "updatedAt");
  if (cutoffMs !== undefined && updated.ms < cutoffMs) return "stop";
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
  const created = githubTime(record.createdAt, "createdAt");
  return {
    role: author.role,
    name: author.name,
    body: record.body,
    createdAt: created.iso,
    source: { kind: "github", id: record.id, url: record.url },
  };
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
        nodes {
          id
          url
          body
          createdAt
          updatedAt
          author { __typename login }
        }
      }
    }
  }
}`;
}

type CommentPage = {
  comments: MirroredComment[];
  stop: boolean;
  hasNextPage: boolean;
  endCursor: string | null;
};

function readPage(stdout: string, cutoffMs: number | undefined): CommentPage {
  const repository = parseGhGraphqlRepository(stdout);
  if (!repository) {
    throw new IssueError("gh-failed", "gh graphql returned no repository");
  }
  const pullRequest = repository.pullRequest;
  if (pullRequest == null) {
    throw new IssueError("gh-failed", "gh graphql returned no pull request");
  }
  const pr = asRecord(pullRequest, "pull request");
  const connection = asRecord(pr.comments, "comment page");
  const nodes = connection.nodes;
  if (!Array.isArray(nodes)) {
    throw new IssueError("gh-failed", "gh graphql returned an unexpected comment page");
  }
  const pageInfo = asRecord(connection.pageInfo, "comment page");
  if (typeof pageInfo.hasNextPage !== "boolean") {
    throw new IssueError("gh-failed", "gh graphql returned an unexpected comment page");
  }
  const endCursor = pageInfo.endCursor;
  if (endCursor != null && typeof endCursor !== "string") {
    throw new IssueError("gh-failed", "gh graphql returned an unexpected comment page");
  }

  const comments: MirroredComment[] = [];
  let stop = false;
  for (const node of nodes) {
    const mapped = mapComment(node, cutoffMs);
    if (mapped === "stop") {
      stop = true;
      break;
    }
    if (mapped) comments.push(mapped);
  }
  return {
    comments,
    stop,
    hasNextPage: pageInfo.hasNextPage,
    endCursor: endCursor ?? null,
  };
}

/**
 * Conversation comments on a pull request. Omit `since` for full history.
 * With `since` (an ISO timestamp), return comments created or updated at or
 * after that time. `edits` stays empty until comment edits are mirrored.
 */
export async function fetchPrComments(
  prUrl: string,
  since: string | undefined,
  workspace: string,
): Promise<PrCommentFetch> {
  const { owner, repo, number } = parsePrUrl(prUrl);
  const cutoffMs = since === undefined ? undefined : sinceMs(since);
  const comments: MirroredComment[] = [];
  let cursor: string | null = null;
  const seenCursors = new Set<string>();

  for (;;) {
    const query = commentsQuery(
      owner,
      repo,
      number,
      cursor,
      since !== undefined,
    );
    const stdout = await runGh(
      ["api", "graphql", "-f", `query=${query}`],
      workspace,
    );
    const page = readPage(stdout, cutoffMs);
    comments.push(...page.comments);
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

  comments.sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) ||
      a.source.id.localeCompare(b.source.id),
  );
  return { comments, edits: [] };
}

function commentInputOf(comment: MirroredComment): CommentInput {
  const {
    createdAt: _createdAt,
    replyToSourceId: _replyToSourceId,
    ...input
  } = comment;
  return input;
}

async function mirrorStoryComments(
  storyId: string,
  prUrl: string,
  workspace: string,
): Promise<void> {
  const startedAt = new Date().toISOString();
  const since = cursors.get(prUrl);
  const { comments } = await fetchPrComments(prUrl, since, workspace);
  const messages = readComments(storyId).messages;
  const seen = new Set(
    messages.flatMap((message) => (message.source ? [message.source.id] : [])),
  );
  for (const comment of comments) {
    if (comment.role !== "human") continue;
    if (seen.has(comment.source.id)) continue;
    const stored = await appendComment(storyId, commentInputOf(comment), {
      at: comment.createdAt,
      messages,
    });
    messages.push(stored);
    seen.add(comment.source.id);
  }
  cursors.set(prUrl, startedAt);
}

/**
 * Sync-pass step after PR reconcile. Lands human conversation comments on
 * each matched Story. The first pass for a PR in this process fetches full
 * history; later passes fetch comments updated since that pass.
 */
export async function mirrorConversationComments(
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
