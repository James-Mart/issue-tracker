import { readyToTaskFrom } from "../../src/features/issues/lib/ready-to-task.js";
import {
  commentEditSchema,
  formatZodError,
  parseComment,
  threadEventSchema,
  type Comment,
  type CommentEdit,
  type CommentsResponse,
  type Problem,
  type TaskStatus,
  type ThreadEvent,
  type ThreadEventName,
  type ThreadView,
} from "../schemas.js";

type ThreadStateEventName = Exclude<
  ThreadEventName,
  "linked" | "researcher-session" | "converted"
>;

const THREAD_EVENT_STATE = {
  resolved: "resolved",
  unresolved: "open",
  dismissed: "dismissed",
  reopened: "open",
} as const satisfies Record<ThreadStateEventName, ThreadView["state"]>;

export function threadStateForEvent(
  event: ThreadStateEventName,
): ThreadView["state"] {
  return THREAD_EVENT_STATE[event];
}

export function isThreadEventRecord(raw: unknown): boolean {
  return (
    typeof raw === "object" &&
    raw !== null &&
    (raw as { type?: unknown }).type === "thread-event"
  );
}

function isCommentEditRecord(raw: unknown): boolean {
  return (
    typeof raw === "object" &&
    raw !== null &&
    (raw as { type?: unknown }).type === "comment-edit"
  );
}

function parseLogRecord(
  raw: unknown,
):
  | { ok: true; kind: "comment"; message: Comment }
  | { ok: true; kind: "event"; event: ThreadEvent }
  | { ok: true; kind: "edit"; edit: CommentEdit }
  | { ok: false; message: string } {
  if (isThreadEventRecord(raw)) {
    const result = threadEventSchema.safeParse(raw);
    if (result.success) return { ok: true, kind: "event", event: result.data };
    return {
      ok: false,
      message: formatZodError(result.error, "invalid thread event"),
    };
  }
  if (isCommentEditRecord(raw)) {
    const result = commentEditSchema.safeParse(raw);
    if (result.success) return { ok: true, kind: "edit", edit: result.data };
    return {
      ok: false,
      message: formatZodError(result.error, "invalid comment edit"),
    };
  }
  const parsed = parseComment(raw);
  if (parsed.ok) return { ok: true, kind: "comment", message: parsed.message };
  return { ok: false, message: parsed.message };
}

export function commentThreadKind(root: {
  kind?: ThreadView["kind"];
}): ThreadView["kind"] {
  return root.kind === "question" ? "question" : "review";
}

/** Root ids of open threads linked to `taskId`, in thread order. */
export function openLinkedThreadRootIds(
  threads: ThreadView[],
  taskId: string,
): string[] {
  return threads
    .filter(
      (thread) =>
        thread.kind === "review" &&
        thread.state === "open" &&
        thread.linkedTaskId === taskId,
    )
    .map((thread) => thread.rootId);
}

export function formatThreadLine(thread: ThreadView): string {
  const kind = thread.kind === "question" ? " question" : "";
  const linked =
    thread.linkedTaskId !== undefined ? ` linked=${thread.linkedTaskId}` : "";
  return `${thread.rootId} ${thread.state}${kind}${linked}`;
}

export function formatThreadsForView(threads: ThreadView[]): string[] {
  return threads.map(formatThreadLine);
}

/** Last resolution and link events win. Unknown thread ids become problems. */
export function deriveThreadViews(
  issueId: string,
  messages: Comment[],
  events: ThreadEvent[],
  taskStatusById: Map<string, TaskStatus> = new Map(),
): { threads: ThreadView[]; problems: Problem[] } {
  const roots = new Set(
    messages.filter((message) => !message.replyTo).map((message) => message.id),
  );
  const problems: Problem[] = [];
  const state = new Map<string, ThreadView["state"]>();
  const linkedTaskId = new Map<string, string>();
  const researcherConversationId = new Map<string, string>();
  const converted = new Map<string, NonNullable<ThreadView["converted"]>>();
  for (const event of events) {
    if (!roots.has(event.threadId)) {
      problems.push({
        id: issueId,
        message: `thread event references unknown thread "${event.threadId}"`,
      });
      continue;
    }
    if (event.event === "linked") {
      linkedTaskId.set(event.threadId, event.taskId!);
      continue;
    }
    if (event.event === "researcher-session") {
      researcherConversationId.set(event.threadId, event.conversationId!);
      continue;
    }
    if (event.event === "converted") {
      converted.set(event.threadId, { by: event.by, at: event.at });
      continue;
    }
    state.set(event.threadId, threadStateForEvent(event.event));
    if (event.event === "unresolved") {
      const linked = linkedTaskId.get(event.threadId);
      if (linked && taskStatusById.get(linked) === "done") {
        linkedTaskId.delete(event.threadId);
      }
    }
  }

  const threads = messages
    .filter((message) => !message.replyTo)
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((root): ThreadView => {
      const conversion = converted.get(root.id);
      const kind = conversion ? "review" : commentThreadKind(root);
      const threadState = state.get(root.id) ?? "open";
      const linked = linkedTaskId.get(root.id);
      const researcher = researcherConversationId.get(root.id);
      return {
        rootId: root.id,
        kind,
        state: threadState,
        ...(linked ? { linkedTaskId: linked } : {}),
        ...(researcher && !conversion
          ? { researcherConversationId: researcher }
          : {}),
        ...(conversion ? { converted: conversion } : {}),
        readyToTask: readyToTaskFrom(kind, threadState, linked),
      };
    });
  return { threads, problems };
}

export type CommentLog = {
  messages: Comment[];
  events: ThreadEvent[];
  edits: CommentEdit[];
  problems: Problem[];
};

/** Latest edit body per comment. Unknown targets become problems. */
export function foldCommentEdits(
  issueId: string,
  messages: Comment[],
  edits: CommentEdit[],
): { messages: Comment[]; problems: Problem[] } {
  const known = new Set(messages.map((message) => message.id));
  const latest = new Map<string, string>();
  const problems: Problem[] = [];
  for (const edit of edits) {
    if (!known.has(edit.commentId)) {
      problems.push({
        id: issueId,
        message: `comment edit references unknown comment "${edit.commentId}"`,
      });
      continue;
    }
    latest.set(edit.commentId, edit.body);
  }
  if (latest.size === 0) return { messages, problems };
  return {
    problems,
    messages: messages.map((message) => {
      const body = latest.get(message.id);
      return body === undefined ? message : { ...message, body };
    }),
  };
}

/** Split a `comments.jsonl` body into comments, thread events, edits, and parse problems. */
export function splitCommentLog(issueId: string, text: string): CommentLog {
  const messages: Comment[] = [];
  const events: ThreadEvent[] = [];
  const edits: CommentEdit[] = [];
  const problems: Problem[] = [];
  text.split("\n").forEach((line, index) => {
    if (!line.trim()) return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      problems.push({
        id: issueId,
        message: `comments.jsonl line ${index + 1}: ${detail}`,
      });
      return;
    }
    const parsed = parseLogRecord(raw);
    if (!parsed.ok) {
      problems.push({
        id: issueId,
        message: `comments.jsonl line ${index + 1}: ${parsed.message}`,
      });
      return;
    }
    if (parsed.kind === "comment") messages.push(parsed.message);
    else if (parsed.kind === "edit") edits.push(parsed.edit);
    else events.push(parsed.event);
  });
  return { messages, events, edits, problems };
}

/** Thread views and problems for an already-split comment log. */
export function commentsFromLog(
  issueId: string,
  log: CommentLog,
  taskStatusById: Map<string, TaskStatus> = new Map(),
): CommentsResponse {
  const folded = foldCommentEdits(issueId, log.messages, log.edits);
  const derived = deriveThreadViews(
    issueId,
    folded.messages,
    log.events,
    taskStatusById,
  );
  return {
    messages: folded.messages,
    threads: derived.threads,
    problems: [...log.problems, ...folded.problems, ...derived.problems],
  };
}

/** Parse a `comments.jsonl` body into comments, thread views, and problems. */
export function parseCommentLog(
  issueId: string,
  text: string,
  taskStatusById: Map<string, TaskStatus> = new Map(),
): CommentsResponse {
  return commentsFromLog(
    issueId,
    splitCommentLog(issueId, text),
    taskStatusById,
  );
}
