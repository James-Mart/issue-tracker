import {
  parseConversationFrame,
  type ConversationTranscriptPage,
  type TranscriptEvent,
} from "@server/schemas";
import {
  applyTranscriptDelta,
  type ConversationEventsState,
} from "./conversation-events-state";

const RECONNECT_DELAY_MS = 2_000;
// The server sends a `ping` every 10s; if none arrives within this window the
// connection is treated as dead (e.g. a dev-proxy zombie after a backend
// restart, which never fires an `error`) and forcibly reconnected.
const HEARTBEAT_TIMEOUT_MS = 25_000;

export type ConversationEventsListener = (
  state: ConversationEventsState,
) => void;

export type ConversationHistorySeed = ConversationTranscriptPage;

type ConversationEntry = {
  listeners: Set<ConversationEventsListener>;
  state: ConversationEventsState;
  dispose: () => void;
};

const entries = new Map<string, ConversationEntry>();

const emptyState = (): ConversationEventsState => ({
  events: [],
  ready: false,
  streamRunActive: null,
  runResyncKey: 0,
  pendingText: undefined,
});

function notify(entry: ConversationEntry): void {
  for (const listener of entry.listeners) {
    listener(entry.state);
  }
}

function openEntry(
  conversationId: string,
  seed: ConversationHistorySeed,
): ConversationEntry {
  let source: EventSource | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const entry: ConversationEntry = {
    listeners: new Set(),
    state: {
      ...emptyState(),
      events: seed.events,
      ready: true,
    },
    dispose: () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      closeSource();
    },
  };

  const setState = (patch: Partial<ConversationEventsState>): void => {
    entry.state = { ...entry.state, ...patch };
    notify(entry);
  };

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
    // Drop stale stream run state and re-seed from GET /run — a run may have
    // finished while disconnected and its `finished` frame is no longer buffered.
    // Keep `events` + `ready` so the UI keeps the last good transcript.
    entry.state = {
      ...entry.state,
      streamRunActive: null,
      runResyncKey: entry.state.runResyncKey + 1,
      pendingText: undefined,
    };
    notify(entry);
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
    if (!entry.state.ready) {
      setState({ ready: true });
    }
  };

  const applyFrame = (event: TranscriptEvent): void => {
    entry.state = {
      ...entry.state,
      events: applyTranscriptDelta(entry.state.events, event),
    };
    notify(entry);
  };

  function connect() {
    source = new EventSource(
      `/api/conversations/${encodeURIComponent(conversationId)}/events`,
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
        setState({ streamRunActive: parsed.event.status === "started" });
        return;
      }
      if (parsed.event.type === "pending") {
        setState({ pendingText: parsed.event.text });
        return;
      }
      applyFrame(parsed.event);
    };
    source.onerror = scheduleReconnect;
  }

  connect();
  return entry;
}

/**
 * Subscribe to a conversation's SSE stream. The first subscriber for an id
 * opens the connection (after history was loaded via react-query); later
 * subscribers attach to the same stream and immediately receive the current
 * folded state; the last unsubscribe closes it.
 */
export function subscribeConversation(
  conversationId: string,
  listener: ConversationEventsListener,
  seed: ConversationHistorySeed,
): () => void {
  let entry = entries.get(conversationId);
  if (!entry) {
    entry = openEntry(conversationId, seed);
    entries.set(conversationId, entry);
  }
  entry.listeners.add(listener);
  listener(entry.state);
  return () => {
    entry.listeners.delete(listener);
    if (entry.listeners.size === 0) {
      entry.dispose();
      entries.delete(conversationId);
    }
  };
}

/** Tear down every live entry — for tests that install a fake `EventSource`. */
export function resetConversationEventsRegistryForTests(): void {
  for (const entry of entries.values()) {
    entry.dispose();
  }
  entries.clear();
}
