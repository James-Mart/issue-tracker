import type { ThreadView } from "@server/schemas";
import {
  commentDayKey,
  commentDayLabel,
} from "@/features/issues/components/comments/marker";
import { conversationThreadFilterKey } from "./review-conversation-filter";

type RunnableThread = {
  kind: ThreadView["kind"];
  state: ThreadView["state"];
  root: { id: string };
};

type RunnableTimelineItem =
  | { kind: "thread"; at: string; thread: RunnableThread }
  | { kind: "submitted"; at: string };

export type ConversationTimelineRun<T> = {
  kind: "run";
  threads: T[];
  resolvedCount: number;
  dismissedCount: number;
  firstAt: string;
  lastAt: string;
};

function foldableThreadKind(
  thread: RunnableThread,
): "resolved" | "dismissed" | null {
  const key = conversationThreadFilterKey(thread);
  if (key === "resolved" || key === "dismissed") return key;
  return null;
}

function isThreadItem<T extends RunnableTimelineItem>(
  item: T,
): item is Extract<T, { kind: "thread" }> {
  return item.kind === "thread";
}

/** A single settled thread stays a timeline item; only a longer run is grouped. */
export function foldTimelineRuns<T extends RunnableTimelineItem>(
  items: readonly T[],
): Array<T | ConversationTimelineRun<Extract<T, { kind: "thread" }>>> {
  const out: Array<T | ConversationTimelineRun<Extract<T, { kind: "thread" }>>> = [];
  let batch: Extract<T, { kind: "thread" }>[] = [];

  const flush = () => {
    if (batch.length === 0) return;
    if (batch.length === 1) {
      out.push(batch[0]);
    } else {
      let resolvedCount = 0;
      let dismissedCount = 0;
      for (const item of batch) {
        if (foldableThreadKind(item.thread) === "resolved") resolvedCount += 1;
        else dismissedCount += 1;
      }
      out.push({
        kind: "run",
        threads: batch,
        resolvedCount,
        dismissedCount,
        firstAt: batch[0].at,
        lastAt: batch[batch.length - 1].at,
      });
    }
    batch = [];
  };

  for (const item of items) {
    if (isThreadItem(item) && foldableThreadKind(item.thread)) {
      batch.push(item);
      continue;
    }
    flush();
    out.push(item);
  }
  flush();
  return out;
}

export function conversationRunKey(run: {
  threads: readonly { thread: { root: { id: string } } }[];
}): string {
  return run.threads.map((item) => item.thread.root.id).join("\0");
}

export function conversationRunHoldsThread(
  run: { threads: readonly { thread: { root: { id: string } } }[] },
  threadId: string | null,
): boolean {
  if (!threadId) return false;
  return run.threads.some((item) => item.thread.root.id === threadId);
}

function dayWithoutYear(at: string): string {
  return commentDayLabel(at, { year: false });
}

/** Counts and the date span for a folded run, for example `6 resolved · 2 dismissed` and `Sep 28 – Sep 30`. */
export function conversationRunCopy(run: {
  resolvedCount: number;
  dismissedCount: number;
  firstAt: string;
  lastAt: string;
}): { counts: string; when: string } {
  const counts: string[] = [];
  if (run.resolvedCount > 0) counts.push(`${run.resolvedCount} resolved`);
  if (run.dismissedCount > 0) counts.push(`${run.dismissedCount} dismissed`);
  const sameDay = commentDayKey(run.firstAt) === commentDayKey(run.lastAt);
  const when = sameDay
    ? dayWithoutYear(run.firstAt)
    : `${dayWithoutYear(run.firstAt)} – ${dayWithoutYear(run.lastAt)}`;
  return { counts: counts.join(" · "), when };
}
