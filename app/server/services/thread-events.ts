import { existsSync, readFileSync } from "fs";
import type { Comment, ThreadEvent, ThreadEventName, ThreadView } from "../schemas.js";
import { IssueError } from "./errors.js";
import {
  appendCommentLogRecords,
  buildStoredComment,
  commentsPathOf,
  readAll,
  readIssueOrThrow,
  serialize,
  taskStatusesForStory,
} from "./issues.js";
import {
  commentThreadKind,
  deriveThreadViews,
  splitCommentLog,
} from "./thread-state.js";

export const AGENT_RESOLVE_REQUIRES_BODY =
  "resolving a thread requires a reply body";
export const AGENT_CANNOT_UNRESOLVE = "agents cannot unresolve a thread";
export const HUMAN_ONLY_QUESTION_EVENT =
  "only a human can dismiss or reopen a question thread";
export const QUESTION_EVENT_ON_REVIEW =
  "dismiss and reopen apply only to a question thread";
export const REVIEW_EVENT_ON_QUESTION =
  "resolve and unresolve apply only to a review thread";

export type AppendThreadEventInput = {
  event: ThreadEventName;
  taskId?: string;
  by: { role: string; name?: string };
  body?: string;
};

export type AppendThreadEventResult = {
  event: ThreadEvent;
  reply?: Comment;
  thread: ThreadView;
};

function author(by: AppendThreadEventInput["by"]): { role: string; name?: string } {
  return {
    role: by.role,
    ...(by.name !== undefined ? { name: by.name } : {}),
  };
}

function assertLinkedTask(storyId: string, taskId: string): void {
  const task = readIssueOrThrow(taskId);
  if (task.kind !== "task" || task.partOf !== storyId) {
    throw new IssueError(
      "validation",
      `task "${taskId}" is not under story "${storyId}"`,
    );
  }
}

function assertActor(input: AppendThreadEventInput): void {
  if (input.event === "linked") {
    if (!input.taskId) {
      throw new IssueError("validation", "linked event requires taskId");
    }
    return;
  }
  if (input.event === "dismissed" || input.event === "reopened") {
    if (input.by.role !== "human") {
      throw new IssueError("validation", HUMAN_ONLY_QUESTION_EVENT);
    }
    return;
  }
  if (input.by.role === "human") return;
  if (input.event === "unresolved") {
    throw new IssueError("validation", AGENT_CANNOT_UNRESOLVE);
  }
  if (input.body === undefined) {
    throw new IssueError("validation", AGENT_RESOLVE_REQUIRES_BODY);
  }
}

/**
 * Append a thread event, and a reply when `body` is set, in one write.
 * Humans may resolve or unresolve a review thread, with or without a reply,
 * and may dismiss or reopen a question thread. Any other role may only
 * resolve a review thread, and only with a reply.
 */
export function appendThreadEvent(
  storyId: string,
  threadId: string,
  input: AppendThreadEventInput & { body: string },
): Promise<AppendThreadEventResult & { reply: Comment }>;
export function appendThreadEvent(
  storyId: string,
  threadId: string,
  input: AppendThreadEventInput,
): Promise<AppendThreadEventResult>;
export function appendThreadEvent(
  storyId: string,
  threadId: string,
  input: AppendThreadEventInput,
): Promise<AppendThreadEventResult> {
  return serialize(() => {
    const issue = readIssueOrThrow(storyId);
    if (issue.kind !== "story") {
      throw new IssueError("validation", `issue "${storyId}" is not a Story`);
    }
    assertActor(input);
    if (input.event === "linked") {
      assertLinkedTask(storyId, input.taskId!);
    }

    const { issues } = readAll();
    const taskStatusById = taskStatusesForStory(storyId, issues);
    const path = commentsPathOf(storyId);
    const split = splitCommentLog(
      storyId,
      existsSync(path) ? readFileSync(path, "utf8") : "",
    );
    const root = split.messages.find((message) => message.id === threadId);
    if (!root || root.replyTo) {
      throw new IssueError(
        "validation",
        `thread "${threadId}" is not a thread root`,
      );
    }
    const kind = commentThreadKind(root);
    if (
      (input.event === "dismissed" || input.event === "reopened") &&
      kind !== "question"
    ) {
      throw new IssueError("validation", QUESTION_EVENT_ON_REVIEW);
    }
    if (
      (input.event === "resolved" || input.event === "unresolved") &&
      kind === "question"
    ) {
      throw new IssueError("validation", REVIEW_EVENT_ON_QUESTION);
    }

    const records: unknown[] = [];
    let reply: Comment | undefined;
    if (input.body !== undefined) {
      reply = buildStoredComment(
        storyId,
        {
          ...author(input.by),
          body: input.body,
          replyTo: threadId,
        },
        split.messages,
      );
      records.push(reply);
    }

    const event: ThreadEvent = {
      type: "thread-event",
      threadId,
      event: input.event,
      ...(input.event === "linked" ? { taskId: input.taskId } : {}),
      by: author(input.by),
      at: new Date().toISOString(),
    };
    records.push(event);
    appendCommentLogRecords(storyId, records);

    const messages = reply ? [...split.messages, reply] : split.messages;
    const events = [...split.events, event];
    const thread = deriveThreadViews(
      storyId,
      messages,
      events,
      taskStatusById,
    ).threads.find((view) => view.rootId === threadId)!;
    return reply ? { event, reply, thread } : { event, thread };
  });
}
