import type { Comment, CommentType, IssuePatch } from "../schemas.js";
import { IssueError } from "./errors.js";
import { appendComment, read, readComments, update } from "./issues.js";

export const ALREADY_AWAITING_HUMAN = "review is already awaiting-human";
export const NOT_AWAITING_HUMAN = "review is not awaiting-human";
export const RUNTIME_CHECK_FAILED = "Runtime check failed";
export const STORY_REVIEW_HAS_A_QUESTION = "Story review has a question";
export const WOULD_REVERSE_YOUR_CHANGE = "Would reverse your change";

const SECRET_KEY = /^[A-Z_][A-Z0-9_]*$/;
const BULLET = /^[-*+] (.*)$/;
const SECRET_ITEM = /^Secret `([^`]*)`:(.*)$/;
const LABELED_ITEM = /^(Input|Observation):(.*)$/;

/** Normalize a request, observation, question, or reversal file to the text stored as the comment body. */
export function normalizeCommentFileBody(body: string): string {
  const text = body.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

/**
 * Request format from the human-handoff Story: a Markdown bullet list whose
 * items each start with `Secret `KEY`:`, `Input:`, or `Observation:`.
 * Returns an error naming the first bad item, or undefined when the body follows the format.
 */
export function requestFormatError(body: string): string | undefined {
  const lines = normalizeCommentFileBody(body).split("\n");
  let sawItem = false;
  for (const line of lines) {
    if (line.trim() === "") continue;
    sawItem = true;
    const bullet = BULLET.exec(line);
    const item = bullet?.[1];
    if (!bullet || item === undefined || item.length === 0 || !itemFollowsFormat(item)) {
      const named = item && item.length > 0 ? item : line;
      return `request item does not follow the Request format: ${named}`;
    }
  }
  if (!sawItem) return "request body has no items";
  return undefined;
}

function itemFollowsFormat(item: string): boolean {
  if (item.startsWith("Secret ")) {
    const match = SECRET_ITEM.exec(item);
    if (!match) return false;
    const key = match[1] ?? "";
    const rest = match[2] ?? "";
    return SECRET_KEY.test(key) && rest.trim().length > 0;
  }
  const labeled = LABELED_ITEM.exec(item);
  if (!labeled) return false;
  return (labeled[2] ?? "").trim().length > 0;
}

function assertStory(storyId: string): { review?: string } {
  const issue = read(storyId);
  if (issue.kind !== "story") {
    throw new IssueError(
      "validation",
      `"${storyId}" is a ${issue.kind}, not a story`,
    );
  }
  return issue;
}

function responseBody(note: string | undefined): string {
  if (note === undefined || note.trim() === "") return "";
  return note;
}

/** Post a human-request thread root and set `review` to `awaiting-human`. */
export async function requestHuman(storyId: string, body: string): Promise<Comment> {
  const story = assertStory(storyId);
  if (story.review === "awaiting-human") {
    throw new IssueError("conflict", ALREADY_AWAITING_HUMAN);
  }
  const formatError = requestFormatError(body);
  if (formatError) throw new IssueError("validation", formatError);

  const message = await appendComment(storyId, {
    role: "story-review",
    type: "human-request",
    body: normalizeCommentFileBody(body),
  });
  await update(storyId, { review: "awaiting-human" });
  return message;
}

/** Post a story-review comment of `type` and raise `needsAttention` with `attentionReason`. */
async function stopForHuman(
  storyId: string,
  type: CommentType,
  body: string,
  attentionReason: string,
  patch: IssuePatch = {},
): Promise<Comment> {
  assertStory(storyId);
  const message = await appendComment(storyId, {
    role: "story-review",
    type,
    body: normalizeCommentFileBody(body),
  });
  await update(storyId, { ...patch, needsAttention: true, attentionReason });
  return message;
}

/**
 * Stop for the human on a runtime failure. `review` is unset so that clearing
 * attention runs Story review again.
 */
export function reportRuntimeFailure(
  storyId: string,
  observation: string,
): Promise<Comment> {
  return stopForHuman(storyId, "runtime-failure", observation, RUNTIME_CHECK_FAILED, {
    review: null,
  });
}

/**
 * Stop for the human on diff findings that would undo or rework a change
 * they directed. `review` is unset so that clearing attention runs Story
 * review again.
 */
export function reportReversal(storyId: string, reversal: string): Promise<Comment> {
  return stopForHuman(storyId, "reversal", reversal, WOULD_REVERSE_YOUR_CHANGE, {
    review: null,
  });
}

/**
 * Stop for the human when Story review cannot tell what their guidance means
 * or whether a finding would reverse their change.
 */
export function askReviewQuestion(storyId: string, question: string): Promise<Comment> {
  return stopForHuman(storyId, "review-question", question, STORY_REVIEW_HAS_A_QUESTION);
}

/** Reply to the latest human-request and clear `review`. */
export async function humanDone(
  storyId: string,
  note?: string,
): Promise<Comment> {
  const story = assertStory(storyId);
  if (story.review !== "awaiting-human") {
    throw new IssueError("conflict", NOT_AWAITING_HUMAN);
  }

  const { messages } = readComments(storyId);
  let requestId: string | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.type === "human-request" && !message.replyTo) {
      requestId = message.id;
      break;
    }
  }
  if (!requestId) {
    throw new IssueError(
      "validation",
      `no human-request comment on "${storyId}"`,
    );
  }

  const message = await appendComment(storyId, {
    role: "human",
    type: "human-response",
    body: responseBody(note),
    replyTo: requestId,
  });
  await update(storyId, { review: null });
  return message;
}
