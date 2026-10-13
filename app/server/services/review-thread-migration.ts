import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { issuesDir } from "../config.js";
import type { ConversationMeta } from "../schemas.js";
import type { ReviewIssue } from "../schemas/review.js";
import { storedConversationMetas } from "./conversation-ids.js";
import { persistConversationMeta } from "./conversation-meta-index.js";
import { commentsJsonPath } from "./issues-file.js";
import { replaceFileAtomically } from "./issues-store-lock.js";
import { buildReviewIssue, storedReviewForStory } from "./reviews.js";
import { forEachOnDiskIssue } from "./scan-disk.js";
import { ancestorChain } from "./subtree.js";

const MIGRATION_FLAG = ".review-threads-migrated";

/**
 * One non-blank `comments.jsonl` line. `record` is absent when the line is not
 * a JSON object; such a line stays on the Story, where reads report it.
 */
type LogLine = { text: string; record?: Record<string, unknown> };

type StoryMove = {
  storyId: string;
  reviewId: string;
  keep: string[];
  move: string[];
};

function flagPath(): string {
  return join(issuesDir, MIGRATION_FLAG);
}

function readLogLines(path: string): LogLine[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((text) => text.trim().length > 0)
    .map((text) => {
      try {
        const parsed: unknown = JSON.parse(text);
        return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
          ? { text, record: parsed as Record<string, unknown> }
          : { text };
      } catch {
        return { text };
      }
    });
}

function isComment(record: Record<string, unknown>): boolean {
  return record.type !== "thread-event" && record.type !== "comment-edit";
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Thread roots code review owns: an anchored root, a root with a thread kind,
 * a root a submission names (its threads or its summary), or a root with a
 * thread event. Human-request threads and GitHub-mirrored threads stay on the Story.
 */
function reviewRootIds(lines: readonly LogLine[], review: ReviewIssue | undefined): Set<string> {
  const claimed = new Set(
    (review?.submissions ?? []).flatMap((submission) => [
      ...submission.threadIds,
      ...(submission.summaryCommentId ? [submission.summaryCommentId] : []),
    ]),
  );
  const withEvents = new Set(
    lines.flatMap(({ record }) => {
      const threadId =
        record?.type === "thread-event" ? stringField(record, "threadId") : undefined;
      return threadId ? [threadId] : [];
    }),
  );
  const roots = new Set<string>();
  for (const { record } of lines) {
    if (!record || !isComment(record) || record.replyTo !== undefined) continue;
    const id = stringField(record, "id");
    if (!id) continue;
    if (record.type === "human-request" || record.source !== undefined) continue;
    if (
      record.anchor !== undefined ||
      record.kind !== undefined ||
      claimed.has(id) ||
      withEvents.has(id)
    ) {
      roots.add(id);
    }
  }
  return roots;
}

/** Lines of the review's threads (roots, replies, events, and edits), in log order. */
function splitStoryLog(
  lines: readonly LogLine[],
  roots: ReadonlySet<string>,
): { keep: string[]; move: string[] } {
  const isMovedRoot = (id: string | undefined) => id !== undefined && roots.has(id);
  const movedComments = new Set<string>();
  for (const { record } of lines) {
    if (!record || !isComment(record)) continue;
    const id = stringField(record, "id");
    if (id && (isMovedRoot(id) || isMovedRoot(stringField(record, "replyTo")))) {
      movedComments.add(id);
    }
  }
  const isMovedComment = (id: string | undefined) => id !== undefined && movedComments.has(id);
  const keep: string[] = [];
  const move: string[] = [];
  for (const { text, record } of lines) {
    const moves =
      record !== undefined &&
      (record.type === "thread-event"
        ? isMovedRoot(stringField(record, "threadId"))
        : record.type === "comment-edit"
          ? isMovedComment(stringField(record, "commentId"))
          : isMovedComment(stringField(record, "id")));
    (moves ? move : keep).push(text);
  }
  return { keep, move };
}

function logText(lines: readonly string[]): string {
  return lines.map((line) => `${line}\n`).join("");
}

/**
 * One-time: move each Story's review threads and review-channel conversations
 * onto the Story's review issue, creating that review when the Story has none.
 * Other Story comments stay. A line already on the review (an interrupted run)
 * is not appended again.
 */
export function ensureReviewThreadsMigrated(): void {
  if (existsSync(flagPath())) return;

  const issues = [...forEachOnDiskIssue()].map(({ issue }) => issue);
  const taken = new Set(existsSync(issuesDir) ? readdirSync(issuesDir) : []);
  const conversations = storedConversationMetas().filter(
    (meta) => meta.channel === "review" && meta.issueId !== undefined,
  );
  const now = new Date().toISOString();
  const created: ReviewIssue[] = [];
  const moves: StoryMove[] = [];
  const retargets: ConversationMeta[] = [];

  for (const story of issues) {
    if (story.kind !== "story") continue;
    const lines = readLogLines(commentsJsonPath(story.id));
    const graph = [...issues, ...created];
    const existing = storedReviewForStory(story.id, graph);
    const roots = reviewRootIds(lines, existing);
    const storyConversations = conversations.filter((meta) => meta.issueId === story.id);
    if (roots.size === 0 && storyConversations.length === 0) continue;

    let review = existing;
    if (!review) {
      review = buildReviewIssue(story, ancestorChain(story.id, graph)[0]!.id, graph, taken, {
        archived: story.merged || story.archived,
        now,
      });
      taken.add(review.id);
      created.push(review);
    }
    const { keep, move } = splitStoryLog(lines, roots);
    if (move.length > 0) moves.push({ storyId: story.id, reviewId: review.id, keep, move });
    for (const meta of storyConversations) retargets.push({ ...meta, issueId: review.id });
  }

  for (const review of created) {
    mkdirSync(join(issuesDir, review.id), { recursive: true });
    replaceFileAtomically(
      join(issuesDir, review.id, "issue.json"),
      `${JSON.stringify(review, null, 2)}\n`,
    );
  }
  for (const { storyId, reviewId, keep, move } of moves) {
    const reviewPath = commentsJsonPath(reviewId);
    const present = readLogLines(reviewPath).map(({ text }) => text);
    const known = new Set(present);
    replaceFileAtomically(
      reviewPath,
      logText([...present, ...move.filter((line) => !known.has(line))]),
    );
    replaceFileAtomically(commentsJsonPath(storyId), logText(keep));
  }
  for (const meta of retargets) persistConversationMeta(meta);

  mkdirSync(issuesDir, { recursive: true });
  writeFileSync(flagPath(), "");
}
