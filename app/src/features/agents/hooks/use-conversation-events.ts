import { useEffect, useState } from "react";
import {
  parseTranscriptEvent,
  type TranscriptEvent,
} from "@server/schemas";

const RECONNECT_DELAY_MS = 2_000;
// The server sends a `ping` every 10s; if none arrives within this window the
// connection is treated as dead (e.g. a dev-proxy zombie after a backend
// restart, which never fires an `error`) and forcibly reconnected.
const HEARTBEAT_TIMEOUT_MS = 25_000;

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

/**
 * Subscribe to `GET /api/conversations/:id/events`. Replays persisted
 * history on connect, then folds live frames into local thread state.
 * Tears down (and clears) when `conversationId` changes or the hook unmounts.
 */
export function useConversationEvents(
  conversationId: string | null | undefined,
): TranscriptEvent[] {
  const [events, setEvents] = useState<TranscriptEvent[]>([]);

  useEffect(() => {
    if (!conversationId) {
      setEvents([]);
      return;
    }
    const id = conversationId;

    let source: EventSource | null = null;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    setEvents([]);

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

    function connect() {
      source = new EventSource(
        `/api/conversations/${encodeURIComponent(id)}/events`,
      );
      armWatchdog();
      source.addEventListener("open", () => {
        // Reconnect / first open: drop any prior frames so the replay is
        // authoritative (avoids duplicating history after a reconnect).
        setEvents([]);
        armWatchdog();
      });
      source.addEventListener("ping", armWatchdog);
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
        const parsed = parseTranscriptEvent(data);
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
    };
  }, [conversationId]);

  return events;
}
