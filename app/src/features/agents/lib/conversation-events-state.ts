import type { TranscriptEvent } from "@server/schemas";

export type ConversationEventsState = {
  events: TranscriptEvent[];
  /**
   * True after at least one successful connect+replay (server `ping` after
   * replay). Stays true across reconnects so the thread keeps painting the
   * last good transcript instead of flashing the loading skeleton.
   */
  ready: boolean;
  /**
   * Live run lifecycle from SSE `run` frames. `null` until the first frame
   * on this subscription (including catch-up replay).
   */
  streamRunActive: boolean | null;
  /**
   * Increments on each SSE reconnect so run-active state can re-seed from
   * `GET /run` when a missed `finished` frame would otherwise stick Stop on.
   */
  runResyncKey: number;
  /**
   * Pending message text from SSE `pending` frames. `undefined` until the
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
      };
      return next;
    }
  }

  return [...events, event];
}

/** Begin staging transcript replay (persisted history + catch-up) for one connect. */
export function beginReplayStaging(): {
  replaying: true;
  replayBuffer: TranscriptEvent[];
} {
  return { replaying: true, replayBuffer: [] };
}

/** Fold one transcript frame during connect — buffer while staging, else live. */
export function foldStreamTranscriptFrame(
  replaying: boolean,
  replayBuffer: TranscriptEvent[],
  liveEvents: TranscriptEvent[],
  event: TranscriptEvent,
): {
  replaying: boolean;
  replayBuffer: TranscriptEvent[];
  liveEvents: TranscriptEvent[];
} {
  if (replaying) {
    return {
      replaying: true,
      replayBuffer: applyTranscriptEvent(replayBuffer, event),
      liveEvents,
    };
  }
  return {
    replaying,
    replayBuffer,
    liveEvents: applyTranscriptEvent(liveEvents, event),
  };
}

/** Commit staged replay on the server's first post-replay `ping`. */
export function commitReplayStaging(replayBuffer: TranscriptEvent[]): {
  replaying: false;
  replayBuffer: TranscriptEvent[];
  events: TranscriptEvent[];
} {
  return {
    replaying: false,
    replayBuffer: [],
    events: replayBuffer,
  };
}
