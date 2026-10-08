import { appendFileSync, existsSync, readFileSync } from "fs";
import { randomUUID } from "crypto";
import {
  isLineAnchor,
  parseCommentInput,
  type Comment,
  type CommentInput,
  type CommentsResponse,
  type Issue,
  type TaskStatus,
} from "../schemas.js";
import { validateFullCommitSha } from "./commit-sha.js";
import { IssueError } from "./errors.js";
import {
  commentsPathOf,
  readAll,
  readIssueOrThrow,
  requireKindCapability,
  serialize,
  taskStatusesForStory,
} from "./issues.js";
import { assertStoreWritable } from "./store-read-only.js";
import { parseCommentLog } from "./thread-state.js";

export function readComments(id: string, issues?: Issue[]): CommentsResponse {
  const issue = readIssueOrThrow(id);
  const path = commentsPathOf(id);
  if (!existsSync(path)) return { messages: [], threads: [], problems: [] };
  const taskStatusById =
    issue.kind === "story"
      ? taskStatusesForStory(id, issues ?? readAll().issues)
      : new Map<string, TaskStatus>();
  return parseCommentLog(id, readFileSync(path, "utf8"), taskStatusById);
}

/** Validate and stamp one comment. Caller writes it inside `serialize`. */
export function buildStoredComment(
  issueId: string,
  input: CommentInput,
  messages?: Comment[],
  at?: string,
): Comment {
  const parsed = parseCommentInput(input);
  if (!parsed.ok) throw new IssueError("validation", parsed.message);
  validateCommentAppend(issueId, parsed.input, messages);
  return {
    ...parsed.input,
    id: randomUUID(),
    at: at ?? new Date().toISOString(),
  };
}

/** Append JSONL records in one write. Caller holds `serialize`. */
export function appendCommentLogRecords(id: string, records: unknown[]): void {
  appendFileSync(
    commentsPathOf(id),
    records.map((record) => `${JSON.stringify(record)}\n`).join(""),
  );
}

function validateCommentAppend(
  issueId: string,
  input: CommentInput,
  messages?: Comment[],
): void {
  if (input.kind !== undefined && readIssueOrThrow(issueId).kind !== "story") {
    throw new IssueError("validation", "comment kind is only valid on a Story");
  }

  if (input.anchor) {
    validateFullCommitSha(input.anchor.commitSha);
    if (
      isLineAnchor(input.anchor) &&
      input.anchor.startLine !== undefined &&
      input.anchor.startLine > input.anchor.line
    ) {
      throw new IssueError(
        "validation",
        `anchor.startLine (${input.anchor.startLine}) must not be greater than anchor.line (${input.anchor.line})`,
      );
    }
  }

  const known =
    input.replyTo !== undefined || input.source !== undefined
      ? (messages ?? readComments(issueId).messages)
      : [];

  if (input.source) {
    const sourceId = input.source.id;
    if (known.some((message) => message.source?.id === sourceId)) {
      throw new IssueError(
        "validation",
        `comment source "${sourceId}" is already on this issue`,
      );
    }
  }

  if (!input.replyTo) return;

  if (input.anchor) {
    throw new IssueError(
      "validation",
      "replyTo and anchor cannot be set on the same comment",
    );
  }

  const root = known.find((message) => message.id === input.replyTo);
  if (!root) {
    throw new IssueError(
      "validation",
      `replyTo references unknown comment "${input.replyTo}"`,
    );
  }
  if (root.replyTo) {
    throw new IssueError(
      "validation",
      `replyTo must name a thread root, not a reply (comment "${input.replyTo}" has replyTo "${root.replyTo}")`,
    );
  }
}

export function appendComment(
  id: string,
  input: CommentInput,
  options?: { at?: string; messages?: Comment[] },
): Promise<Comment> {
  return serialize(() => {
    assertStoreWritable();
    requireKindCapability(id, "comments");
    if (options?.at !== undefined && Number.isNaN(Date.parse(options.at))) {
      throw new IssueError(
        "validation",
        `comment at is not a timestamp: ${options.at}`,
      );
    }
    const message = buildStoredComment(
      id,
      input,
      options?.messages,
      options?.at,
    );
    appendCommentLogRecords(id, [message]);
    return message;
  });
}
