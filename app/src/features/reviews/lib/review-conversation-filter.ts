import { useCallback, useSyncExternalStore } from "react";
import type { ThreadView } from "@server/schemas";
import { isQuestionThread } from "@/features/issues/lib/comment-threads";

/** One selection for this browser, shared by every review. */
export const REVIEW_CONVERSATION_FILTER_STORAGE_KEY =
  "issue-tracker.review-conversation-filter";

export const CONVERSATION_FILTER_CHIPS = [
  { key: "comments", label: "Comments" },
  { key: "resolved", label: "Resolved comments" },
  { key: "questions", label: "Questions (open)" },
  { key: "dismissed", label: "Dismissed questions" },
] as const;

export type ConversationFilterKey =
  (typeof CONVERSATION_FILTER_CHIPS)[number]["key"];

export type ConversationFilter = Record<ConversationFilterKey, boolean>;

export type ConversationFilterCounts = Record<ConversationFilterKey, number>;

type FilterableTimelineItem =
  | {
      kind: "thread";
      thread: { kind: ThreadView["kind"]; state: ThreadView["state"] };
    }
  | { kind: "submitted" };

/** Comments, resolved comments, and open questions. Dismissed questions stay off. */
export const DEFAULT_CONVERSATION_FILTER: ConversationFilter = {
  comments: true,
  resolved: true,
  questions: true,
  dismissed: false,
};

const listeners = new Set<() => void>();

let cachedRaw: string | null | undefined;
let cachedFilter: ConversationFilter = { ...DEFAULT_CONVERSATION_FILTER };

function copyDefaultConversationFilter(): ConversationFilter {
  return { ...DEFAULT_CONVERSATION_FILTER };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function isConversationFilter(value: unknown): value is ConversationFilter {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return CONVERSATION_FILTER_CHIPS.every(
    (chip) => typeof record[chip.key] === "boolean",
  );
}

/**
 * A stored filter this browser cannot read is the default selection.
 * Browser storage is external input.
 */
export function parseConversationFilter(raw: string | null): ConversationFilter {
  if (raw === null) return copyDefaultConversationFilter();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isConversationFilter(parsed)) return copyDefaultConversationFilter();
    return {
      comments: parsed.comments,
      resolved: parsed.resolved,
      questions: parsed.questions,
      dismissed: parsed.dismissed,
    };
  } catch {
    return copyDefaultConversationFilter();
  }
}

export function conversationFilterIsDefault(filter: ConversationFilter): boolean {
  return CONVERSATION_FILTER_CHIPS.every(
    (chip) => filter[chip.key] === DEFAULT_CONVERSATION_FILTER[chip.key],
  );
}

/**
 * Questions that are not dismissed count as open. Review threads that are
 * not resolved, including Story notes, count as comments.
 */
export function conversationThreadFilterKey(thread: {
  kind: ThreadView["kind"];
  state: ThreadView["state"];
}): ConversationFilterKey {
  if (isQuestionThread(thread)) {
    return thread.state === "dismissed" ? "dismissed" : "questions";
  }
  return thread.state === "resolved" ? "resolved" : "comments";
}

export function conversationFilterCounts(
  items: readonly FilterableTimelineItem[],
): ConversationFilterCounts {
  const counts = Object.fromEntries(
    CONVERSATION_FILTER_CHIPS.map((chip) => [chip.key, 0]),
  ) as ConversationFilterCounts;
  for (const item of items) {
    if (item.kind !== "thread") continue;
    counts[conversationThreadFilterKey(item.thread)] += 1;
  }
  return counts;
}

export function filterConversationTimeline<T extends FilterableTimelineItem>(
  items: readonly T[],
  filter: ConversationFilter,
): T[] {
  return items.filter((item) => {
    if (item.kind === "submitted") return true;
    return filter[conversationThreadFilterKey(item.thread)];
  });
}

function readConversationFilter(): ConversationFilter {
  const raw = localStorage.getItem(REVIEW_CONVERSATION_FILTER_STORAGE_KEY);
  if (raw === cachedRaw) return cachedFilter;
  cachedRaw = raw;
  cachedFilter = parseConversationFilter(raw);
  return cachedFilter;
}

function writeConversationFilter(filter: ConversationFilter): void {
  if (conversationFilterIsDefault(filter)) {
    localStorage.removeItem(REVIEW_CONVERSATION_FILTER_STORAGE_KEY);
    cachedRaw = null;
    cachedFilter = copyDefaultConversationFilter();
  } else {
    const raw = JSON.stringify(filter);
    localStorage.setItem(REVIEW_CONVERSATION_FILTER_STORAGE_KEY, raw);
    cachedRaw = raw;
    cachedFilter = filter;
  }
  for (const listener of listeners) listener();
}

/** The conversation filter stored in this browser. */
export function useConversationFilter(): {
  filter: ConversationFilter;
  toggle: (key: ConversationFilterKey) => void;
  reset: () => void;
} {
  const filter = useSyncExternalStore(subscribe, readConversationFilter);
  const toggle = useCallback((key: ConversationFilterKey) => {
    const current = readConversationFilter();
    writeConversationFilter({ ...current, [key]: !current[key] });
  }, []);
  const reset = useCallback(() => {
    writeConversationFilter(DEFAULT_CONVERSATION_FILTER);
  }, []);
  return { filter, toggle, reset };
}
