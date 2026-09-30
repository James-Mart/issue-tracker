import type {
  ConversationTranscriptPage,
  TranscriptEvent,
} from "@server/schemas";
import {
  findOpenThinkingIndex,
  isBlankThinkingText,
  isTopLevelThinkingInterrupt,
} from "./thinking-coalesce";

export type OlderEventsStatus = "idle" | "loading" | "error";

export type ConversationEventsState = {
  events: TranscriptEvent[];
  /**
   * True once history has been seeded (or the first stream `ping` arrives).
   * Stays true across reconnects so the thread keeps painting the last good
   * transcript instead of flashing the loading skeleton.
   */
  ready: boolean;
  /**
   * Live run lifecycle from topic `run` frames. `null` until the first frame
   * on this subscription (including catch-up replay).
   */
  streamRunActive: boolean | null;
  /**
   * Increments on topic reset (and legacy reconnect paths) so run-active state
   * can re-seed from `GET /run` when a missed `finished` frame would otherwise
   * stick Stop on.
   */
  runResyncKey: number;
  /**
   * Pending message text from topic `pending` frames. `undefined` until the
   * first frame on this subscription — seed from conversation meta until then.
   */
  pendingText: string | null | undefined;
  /**
   * Live `{ type: "steering" }` text waiting on a persisted prompt or a
   * matching pending fallback. `null` once that frame is resolved.
   */
  steeringText: string | null;
  /**
   * True after a pending frame arrives for the same text as an in-flight
   * steer — the queued row is a mid-run delivery fallback.
   */
  pendingSteerFallback: boolean;
  /** Persisted events remain before the oldest loaded page. */
  hasOlder: boolean;
  /** Scroll-up fetch of the next older page. */
  olderStatus: OlderEventsStatus;
  /**
   * Folded rows that older pages added ahead of the first seeded page. Index
   * row keys subtract it so rows already on screen keep their keys.
   */
  prependedRows: number;
};

export const idleConversationEventsState = (): ConversationEventsState => ({
  events: [],
  ready: false,
  streamRunActive: null,
  runResyncKey: 0,
  pendingText: undefined,
  steeringText: null,
  pendingSteerFallback: false,
  hasOlder: false,
  olderStatus: "idle",
  prependedRows: 0,
});

/** GET pages always stamp `seq`; a page event without one is a server bug. */
export function pageEventSeq(event: TranscriptEvent): number {
  if (event.seq === undefined) {
    throw new Error(`transcript page ${event.type} event has no seq`);
  }
  return event.seq;
}

export type JoinedLatestPage = {
  events: TranscriptEvent[];
  hasOlder: boolean;
  /** False when the page replaced the loaded events instead of extending them. */
  joined: boolean;
};

/**
 * Join a refetched latest page onto the raw pages loaded so far. The join
 * holds when the page is the whole transcript or reaches back into the loaded
 * range. Otherwise events that were never loaded sit between the two, and the
 * page replaces what was loaded.
 */
export function joinLatestPage(
  loaded: readonly TranscriptEvent[],
  hasOlder: boolean,
  page: ConversationTranscriptPage,
): JoinedLatestPage {
  if (page.hasMore !== true) {
    return { events: page.events, hasOlder: false, joined: true };
  }
  const first = pageEventSeq(page.events[0]!);
  const last = loaded.at(-1);
  if (last === undefined || first > pageEventSeq(last)) {
    return { events: page.events, hasOlder: true, joined: false };
  }
  return {
    events: [
      ...loaded.filter((event) => pageEventSeq(event) < first),
      ...page.events,
    ],
    hasOlder,
    joined: true,
  };
}

/**
 * Fold an older page onto the rows on screen. Those rows carry live deltas the
 * raw pages never saw; folding them again leaves them unchanged, while a chain
 * that crosses the page boundary merges into one row.
 */
export function prependOlderPage(
  state: Pick<ConversationEventsState, "events" | "prependedRows">,
  page: ConversationTranscriptPage,
): Pick<ConversationEventsState, "events" | "hasOlder" | "prependedRows"> {
  const events = foldTranscriptEvents([...page.events, ...state.events]);
  return {
    events,
    hasOlder: page.hasMore === true,
    prependedRows: state.prependedRows + events.length - state.events.length,
  };
}

function applyThinkingEvent(
  events: TranscriptEvent[],
  event: Extract<TranscriptEvent, { type: "thinking" }>,
): TranscriptEvent[] {
  if (isBlankThinkingText(event.text)) return events;

  const idx = findOpenThinkingIndex(
    events,
    (e) => e.type === "thinking",
    isTopLevelThinkingInterrupt,
  );
  if (idx < 0) return [...events, event];

  const last = events[idx] as Extract<TranscriptEvent, { type: "thinking" }>;
  if (event.text === last.text) return events;

  const next = events.slice();
  next[idx] = {
    ...last,
    text: last.text + event.text,
    at: event.at,
    ...(event.seq !== undefined ? { seq: event.seq } : {}),
  };
  return next;
}

/**
 * Fold one SSE frame into local thread state.
 *
 * Live assistant and thinking frames are incremental deltas followed by a
 * coalesced finalize with the same full text — concatenate deltas into the
 * open block and skip the duplicate finalize. Thinking looks past invisible
 * noise (`usage`, bare `status`, folded `subagent_update`). `tool_call`
 * frames for the same `callId` replace in place (running → completed/error).
 * Empty / whitespace-only thinking never becomes a row.
 */
export function applyTranscriptEvent(
  events: TranscriptEvent[],
  event: TranscriptEvent,
): TranscriptEvent[] {
  if (event.type === "tool_call") {
    const idx = events.findIndex(
      (e) => e.type === "tool_call" && e.callId === event.callId,
    );
    if (idx >= 0) {
      const next = events.slice();
      next[idx] = event;
      return next;
    }
    return [...events, event];
  }

  if (event.type === "thinking") {
    return applyThinkingEvent(events, event);
  }

  if (event.type === "assistant") {
    const last = events[events.length - 1];
    if (last?.type === "assistant") {
      if (event.text === last.text) return events;
      const next = events.slice();
      next[next.length - 1] = {
        ...last,
        text: last.text + event.text,
        at: event.at,
        ...(event.seq !== undefined ? { seq: event.seq } : {}),
      };
      return next;
    }
  }

  return [...events, event];
}

/**
 * Fold a persisted / GET-seeded transcript through the same live apply path so
 * reload matches streaming coalesce (including Thinking across invisible noise
 * and empty omit).
 */
export function foldTranscriptEvents(
  events: readonly TranscriptEvent[],
): TranscriptEvent[] {
  let folded: TranscriptEvent[] = [];
  for (const event of events) {
    folded = applyTranscriptEvent(folded, event);
  }
  return folded;
}

/**
 * Apply a stream delta on top of seeded history, skipping duplicates and
 * inserting by `seq` when a frame arrives out of order.
 */
export function applyTranscriptDelta(
  events: TranscriptEvent[],
  event: TranscriptEvent,
): TranscriptEvent[] {
  const seq = event.seq;
  if (seq !== undefined) {
    if (events.some((e) => e.seq === seq)) return events;
    const lastSeq = events.at(-1)?.seq;
    if (lastSeq !== undefined && seq < lastSeq) {
      const idx = events.findIndex(
        (e) => e.seq !== undefined && e.seq > seq,
      );
      const at = idx === -1 ? events.length : idx;
      const next = events.slice();
      next.splice(at, 0, event);
      return next;
    }
  }
  return applyTranscriptEvent(events, event);
}

/** Merge catch-up/live deltas onto a history seed in seq order. */
export function mergeTranscriptDeltas(
  base: TranscriptEvent[],
  deltas: TranscriptEvent[],
): TranscriptEvent[] {
  let events = base;
  for (const event of deltas) {
    events = applyTranscriptDelta(events, event);
  }
  return events;
}
