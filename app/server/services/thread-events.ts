import {
  THREAD_EVENT_PAYLOADS,
  type Comment,
  type ThreadEvent,
  type ThreadEventName,
  type ThreadView,
} from "../schemas.js";
import { IssueError } from "./errors.js";
import {
  appendCommentLogRecords,
  buildStoredComment,
  readAll,
  readIssueOrThrow,
  serialize,
  taskStatusesForStory,
} from "./issues.js";
import { readCommentLog } from "./comment-log.js";
import { deriveThreadViews } from "./thread-state.js";

export const AGENT_RESOLVE_REQUIRES_BODY =
  "resolving a thread requires a reply body";
export const AGENT_CANNOT_UNRESOLVE = "agents cannot unresolve a thread";
export const HUMAN_ONLY_QUESTION_EVENT =
  "only a human can dismiss or reopen a question thread";
export const HUMAN_ONLY_CONVERT =
  "only a human can convert a question to a review comment";
export const CONVERT_REQUIRES_OPEN_QUESTION =
  "convert applies only to an open question thread";
export const QUESTION_EVENT_ON_REVIEW =
  "dismiss and reopen apply only to a question thread";
export const REVIEW_EVENT_ON_QUESTION =
  "resolve and unresolve apply only to a review thread";
export const RESEARCHER_ON_REVIEW =
  "a researcher session applies only to a question thread";

export type AppendThreadEventInput = {
  event: ThreadEventName;
  taskId?: string;
  conversationId?: string;
  /** The session replaces an archived or unreadable researcher conversation. */
  recovered?: true;
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

export function findThreadRoot(messages: Comment[], threadId: string): Comment {
  const root = messages.find((message) => message.id === threadId);
  if (!root || root.replyTo) {
    throw new IssueError("validation", `thread "${threadId}" is not a thread root`);
  }
  return root;
}

function assertActor(input: AppendThreadEventInput): void {
  const payload = THREAD_EVENT_PAYLOADS.find(({ event }) => event === input.event);
  if (payload) {
    if (!input[payload.field]) {
      throw new IssueError(
        "validation",
        `${payload.event} event requires ${payload.field}`,
      );
    }
    return;
  }
  if (input.event === "dismissed" || input.event === "reopened") {
    if (input.by.role !== "human") {
      throw new IssueError("validation", HUMAN_ONLY_QUESTION_EVENT);
    }
    return;
  }
  if (input.event === "converted") {
    if (input.by.role !== "human") {
      throw new IssueError("validation", HUMAN_ONLY_CONVERT);
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
 * dismiss or reopen a question thread, and convert an open question into a
 * review thread. Any other role may only resolve a review thread, and only
 * with a reply. `researcher-session` is server-recorded when a question
 * thread's researcher conversation starts. A converted thread keeps its
 * comments and follows the review rules.
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
    const split = readCommentLog(storyId);
    findThreadRoot(split.messages, threadId);
    const prior = deriveThreadViews(
      storyId,
      split.messages,
      split.events,
      taskStatusById,
    ).threads.find((view) => view.rootId === threadId);
    if (!prior) {
      throw new IssueError("validation", `thread "${threadId}" is not a thread root`);
    }
    const kind = prior.kind;
    if (input.event === "converted") {
      if (kind !== "question" || prior.state !== "open") {
        throw new IssueError("validation", CONVERT_REQUIRES_OPEN_QUESTION);
      }
    }
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
    if (input.event === "researcher-session" && kind !== "question") {
      throw new IssueError("validation", RESEARCHER_ON_REVIEW);
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
      ...(input.event === "researcher-session"
        ? {
            conversationId: input.conversationId,
            ...(input.recovered ? { recovered: true as const } : {}),
          }
        : {}),
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
