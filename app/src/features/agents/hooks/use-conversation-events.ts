import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  parseConversationFrame,
  type TranscriptEvent,
} from "@server/schemas";
import { agentsKeys } from "../api/keys";

const RECONNECT_DELAY_MS = 2_000;
// The server sends a `ping` every 10s; if none arrives within this window the
// connection is treated as dead (e.g. a dev-proxy zombie after a backend
// restart, which never fires an `error`) and forcibly reconnected.
const HEARTBEAT_TIMEOUT_MS = 25_000;

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
};

/**
 * Fold one SSE frame into local thread state.
 *
 * Live assistant frames are incremental deltas followed by a coalesced
 * finalize with the same full text — concatenate deltas into the open
 * bubble and skip the duplicate finalize. `tool_call` frames for the same
 * `callId` replace in place (running → completed/error).
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

  if (event.type === "assistant") {
    const last = events[events.length - 1];
    if (last?.type === "assistant") {
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

/**
 * Subscribe to `GET /api/conversations/:id/events`. Replays persisted
 * history on connect, then folds live frames into local thread state.
 * Tears down (and clears) when `conversationId` changes or the hook unmounts.
 *
 * On (re)connect, persisted transcript and catch-up frames are staged into
 * a replay buffer and committed on the first `ping` (after both replays).
 * Prior React state is left alone until that commit, so reconnect does not
 * blank the thread.
 */
export function useConversationEvents(
  conversationId: string | null | undefined,
): ConversationEventsState {
  const qc = useQueryClient();
  const [events, setEvents] = useState<TranscriptEvent[]>([]);
  const [ready, setReady] = useState(false);
  const [streamRunActive, setStreamRunActive] = useState<boolean | null>(null);
  const [runResyncKey, setRunResyncKey] = useState(0);

  useEffect(() => {
    if (!conversationId) {
      setEvents([]);
      setReady(false);
      setStreamRunActive(null);
      setRunResyncKey(0);
      return;
    }
    const id = conversationId;

    let source: EventSource | null = null;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    let replaying = false;
    let replayBuffer: TranscriptEvent[] = [];

    setEvents([]);
    setReady(false);
    setStreamRunActive(null);
    setRunResyncKey(0);

    const closeSource = () => {
      if (watchdog) {
        clearTimeout(watchdog);
        watchdog = null;
      }
      source?.close();
      source = null;
    };

    const scheduleReconnect = () => {
      closeSource();
      replaying = false;
      replayBuffer = [];
      // Drop stale stream run state and re-seed from GET /run — a run may have
      // finished while disconnected and its `finished` frame is no longer buffered.
      setStreamRunActive(null);
      setRunResyncKey((key) => key + 1);
      // Keep `events` + `ready` so the UI keeps the last good transcript.
      if (disposed || reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, RECONNECT_DELAY_MS);
    };

    const armWatchdog = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(scheduleReconnect, HEARTBEAT_TIMEOUT_MS);
    };

    const onPing = () => {
      armWatchdog();
      if (replaying) {
        const committed = commitReplayStaging(replayBuffer);
        replaying = committed.replaying;
        replayBuffer = committed.replayBuffer;
        setEvents(committed.events);
      }
      setReady(true);
    };

    function connect() {
      // Stage before opening the socket so catch-up frames cannot land on live
      // state ahead of the post-replay commit.
      ({ replaying, replayBuffer } = beginReplayStaging());
      source = new EventSource(
        `/api/conversations/${encodeURIComponent(id)}/events`,
      );
      armWatchdog();
      source.addEventListener("open", armWatchdog);
      source.addEventListener("ping", onPing);
      source.onmessage = (raw) => {
        armWatchdog();
        let data: unknown;
        try {
          data = JSON.parse(raw.data as string);
        } catch (err) {
          if (import.meta.env.DEV) {
            console.warn(
              "ignoring malformed conversation event:",
              raw.data,
              err,
            );
          }
          return;
        }
        const parsed = parseConversationFrame(data);
        if (!parsed.ok) {
          if (import.meta.env.DEV) {
            console.warn(
              "ignoring malformed conversation event:",
              raw.data,
              parsed.message,
            );
          }
          return;
        }
        if (parsed.event.type === "run") {
          setStreamRunActive(parsed.event.status === "started");
          // SSE covers only the open conversation; refresh the roster so its
          // `activeRun` flag tracks this thread's lifecycle immediately.
          void qc.invalidateQueries({ queryKey: agentsKeys.conversations() });
          return;
        }
        if (replaying) {
          replayBuffer = applyTranscriptEvent(replayBuffer, parsed.event);
          return;
        }
        setEvents((prev) => applyTranscriptEvent(prev, parsed.event));
      };
      source.onerror = scheduleReconnect;
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      closeSource();
      setEvents([]);
      setReady(false);
      setStreamRunActive(null);
      setRunResyncKey(0);
    };
  }, [conversationId, qc]);

  return { events, ready, streamRunActive, runResyncKey };
}
