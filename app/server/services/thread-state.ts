import {
  formatZodError,
  parseComment,
  threadEventSchema,
  type Comment,
  type CommentsResponse,
  type Problem,
  type ThreadEvent,
  type ThreadEventName,
  type ThreadView,
} from "../schemas.js";

const THREAD_EVENT_STATE = {
  resolved: "resolved",
  unresolved: "open",
} as const satisfies Record<ThreadEventName, ThreadView["state"]>;

export function threadStateForEvent(
  event: ThreadEventName,
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

/** Last resolution event wins. Unknown thread ids become problems. */
export function deriveThreadViews(
  issueId: string,
  messages: Comment[],
  events: ThreadEvent[],
): { threads: ThreadView[]; problems: Problem[] } {
  const roots = new Set(
    messages.filter((message) => !message.replyTo).map((message) => message.id),
  );
  const problems: Problem[] = [];
  const state = new Map<string, ThreadView["state"]>();
  for (const event of events) {
    if (!roots.has(event.threadId)) {
      problems.push({
        id: issueId,
        message: `thread event references unknown thread "${event.threadId}"`,
      });
      continue;
    }
    state.set(event.threadId, threadStateForEvent(event.event));
  }

  const threads = messages
    .filter((message) => !message.replyTo)
    .sort((a, b) => a.at.localeCompare(b.at))
    .map(
      (root): ThreadView => ({
        rootId: root.id,
        kind: "review",
        state: state.get(root.id) ?? "open",
      }),
    );
  return { threads, problems };
}

/** Parse a `comments.jsonl` body into comments, thread views, and problems. */
export function parseCommentLog(issueId: string, text: string): CommentsResponse {
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

  const derived = deriveThreadViews(issueId, messages, events);
  return {
    messages,
    threads: derived.threads,
    problems: [...problems, ...derived.problems],
  };
}
