import type { Comment, ThreadEvent, ThreadEventName, ThreadView } from "../schemas.js";
import { IssueError } from "./errors.js";
import {
  appendCommentLogRecords,
  buildStoredComment,
  readComments,
  readIssueOrThrow,
  serialize,
} from "./issues.js";
import { threadStateForEvent } from "./thread-state.js";

export const AGENT_RESOLVE_REQUIRES_BODY =
  "resolving a thread requires a reply body";
export const AGENT_CANNOT_UNRESOLVE = "agents cannot unresolve a thread";

export type AppendThreadEventInput = {
  event: ThreadEventName;
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

function assertActor(input: AppendThreadEventInput): void {
  if (input.by.role === "human") return;
  if (input.event === "unresolved") {
    throw new IssueError("validation", AGENT_CANNOT_UNRESOLVE);
  }
  if (input.body === undefined) {
    throw new IssueError("validation", AGENT_RESOLVE_REQUIRES_BODY);
  }
}

/**
 * Append a resolution event, and a reply when `body` is set, in one write.
 * Humans may resolve or unresolve with or without a reply. Any other role
 * may only resolve, and only with a reply.
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

    const { messages } = readComments(storyId);
    const root = messages.find((message) => message.id === threadId);
    if (!root || root.replyTo) {
      throw new IssueError(
        "validation",
        `thread "${threadId}" is not a thread root`,
      );
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
        messages,
      );
      records.push(reply);
    }

    const event: ThreadEvent = {
      type: "thread-event",
      threadId,
      event: input.event,
      by: author(input.by),
      at: new Date().toISOString(),
    };
    records.push(event);
    appendCommentLogRecords(storyId, records);

    const thread: ThreadView = {
      rootId: threadId,
      kind: "review",
      state: threadStateForEvent(input.event),
    };
    return reply ? { event, reply, thread } : { event, thread };
  });
}
