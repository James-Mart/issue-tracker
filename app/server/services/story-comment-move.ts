import { existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { issuesDir } from "../config.js";
import type { ReviewIssue } from "../schemas/review.js";
import { commentsJsonPath } from "./issues-file.js";
import { replaceFileAtomically } from "./issues-store-lock.js";

/**
 * One non-blank `comments.jsonl` line. `record` is absent when the line is not
 * a JSON object; such a line stays on the Story, where reads report it.
 */
export type LogLine = { text: string; record?: Record<string, unknown> };

export type StoryMove = {
  storyId: string;
  reviewId: string;
  keep: string[];
  move: string[];
};

export function readLogLines(path: string): LogLine[] {
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

export function isComment(record: Record<string, unknown>): boolean {
  return record.type !== "thread-event" && record.type !== "comment-edit";
}

export function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

/** Lines of the named roots (roots, replies, events, and edits), in log order. */
export function splitStoryLog(
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

export function logText(lines: readonly string[]): string {
  return lines.map((line) => `${line}\n`).join("");
}

/**
 * Write reviews created for a move, then append each move's lines onto that
 * review and leave the rest on the Story. A line already on the review is
 * not appended again.
 */
export function persistStoryCommentMoves(
  created: readonly ReviewIssue[],
  moves: readonly StoryMove[],
): void {
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
}
