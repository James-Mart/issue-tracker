import {
  formatZodError,
  parseComment,
  threadEventSchema,
  type Comment,
  type CommentsResponse,
  type Problem,
  type TaskStatus,
  type ThreadEvent,
  type ThreadEventName,
  type ThreadView,
} from "../schemas.js";

const THREAD_EVENT_STATE = {
  resolved: "resolved",
  unresolved: "open",
} as const satisfies Record<
  Exclude<ThreadEventName, "linked">,
  ThreadView["state"]
>;

export function threadStateForEvent(
  event: Exclude<ThreadEventName, "linked">,
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

function parseLogRecord(
  raw: unknown,
):
  | { ok: true; kind: "comment"; message: Comment }
  | { ok: true; kind: "event"; event: ThreadEvent }
  | { ok: false; message: string } {
  if (isThreadEventRecord(raw)) {
    const result = threadEventSchema.safeParse(raw);
    if (result.success) return { ok: true, kind: "event", event: result.data };
    return {
      ok: false,
      message: formatZodError(result.error, "invalid thread event"),
    };
  }
  const parsed = parseComment(raw);
  if (parsed.ok) return { ok: true, kind: "comment", message: parsed.message };
  return { ok: false, message: parsed.message };
}

export function readyToTaskFrom(
  state: ThreadView["state"],
  linkedTaskId: string | undefined,
): boolean {
  return state === "open" && linkedTaskId === undefined;
}

/** Root ids of open threads linked to `taskId`, in thread order. */
export function openLinkedThreadRootIds(
  threads: ThreadView[],
  taskId: string,
): string[] {
  return threads
    .filter(
      (thread) => thread.state === "open" && thread.linkedTaskId === taskId,
    )
    .map((thread) => thread.rootId);
}

export function formatThreadLine(thread: ThreadView): string {
  const linked =
    thread.linkedTaskId !== undefined ? ` linked=${thread.linkedTaskId}` : "";
  return `${thread.rootId} ${thread.state}${linked}`;
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
      const threadState = state.get(root.id) ?? "open";
      const linked = linkedTaskId.get(root.id);
      return {
        rootId: root.id,
        kind: "review",
        state: threadState,
        ...(linked ? { linkedTaskId: linked } : {}),
        readyToTask: readyToTaskFrom(threadState, linked),
      };
    });
  return { threads, problems };
}

/** Split a `comments.jsonl` body into comments, thread events, and parse problems. */
export function splitCommentLog(
  issueId: string,
  text: string,
): { messages: Comment[]; events: ThreadEvent[]; problems: Problem[] } {
  const messages: Comment[] = [];
  const events: ThreadEvent[] = [];
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
    else events.push(parsed.event);
  });
  return { messages, events, problems };
}

/** Parse a `comments.jsonl` body into comments, thread views, and problems. */
export function parseCommentLog(
  issueId: string,
  text: string,
  taskStatusById: Map<string, TaskStatus> = new Map(),
): CommentsResponse {
  const split = splitCommentLog(issueId, text);
  const derived = deriveThreadViews(
    issueId,
    split.messages,
    split.events,
    taskStatusById,
  );
  return {
    messages: split.messages,
    threads: derived.threads,
    problems: [...split.problems, ...derived.problems],
  };
}
