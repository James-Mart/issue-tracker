import type { TranscriptEvent } from "@server/schemas";

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
};

/**
 * Fold one SSE frame into local thread state.
 *
 * Live assistant and thinking frames are incremental deltas followed by a
 * coalesced finalize with the same full text — concatenate deltas into the
 * open block and skip the duplicate finalize. `tool_call` frames for the
 * same `callId` replace in place (running → completed/error).
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

  if (event.type === "assistant" || event.type === "thinking") {
    const last = events[events.length - 1];
    if (last?.type === event.type) {
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
 * Apply a stream delta on top of seeded history, skipping duplicates and
 * inserting by `seq` when a frame arrives out of order.
 */
export function applyTranscriptDelta(
  events: TranscriptEvent[],
  event: TranscriptEvent,
): TranscriptEvent[] {
  if (event.seq !== undefined) {
    if (events.some((e) => e.seq === event.seq)) return events;
    const lastSeq = events.at(-1)?.seq;
    if (lastSeq !== undefined && event.seq < lastSeq) {
      const idx = events.findIndex(
        (e) => e.seq !== undefined && e.seq > event.seq,
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
