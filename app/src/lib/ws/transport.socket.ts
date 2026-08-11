/**
 * Low-level multiplexed WebSocket owner — one socket, ref-counted topics.
 * The page direct path and the SharedWorker both use this as the inner client.
 */

export type UpstreamEventMessage = {
  type: "event";
  topic: string;
  seq: number;
  event: unknown;
};

export type UpstreamResetMessage = {
  type: "reset";
  topic: string;
};

export type UpstreamMessage = UpstreamEventMessage | UpstreamResetMessage;

type ClientToServerMessage =
  | { type: "subscribe"; topic: string; sinceSeq?: number }
  | { type: "unsubscribe"; topic: string };

type TopicState = {
  refs: number;
  /** Last seq held for this topic (delivered, or seeded from history). */
  lastSeq?: number;
};

const BACKOFF_INITIAL_MS = 500;
const BACKOFF_MAX_MS = 8_000;

export type UpstreamConnection = {
  acquire(topic: string, sinceSeq?: number): void;
  release(topic: string): void;
  holdSeq(topic: string, seq: number): void;
  /** Drop the socket and held topics (worker shutdown / tests). */
  close(): void;
  resetForTests(): void;
};

export function createUpstreamConnection(options: {
  wsUrl: () => string;
  onMessage: (message: UpstreamMessage) => void;
}): UpstreamConnection {
  const topics = new Map<string, TopicState>();
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let backoffMs = BACKOFF_INITIAL_MS;

  function send(message: ClientToServerMessage): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(message));
  }

  function subscribeMessage(
    topic: string,
    state: TopicState,
  ): ClientToServerMessage {
    if (state.lastSeq !== undefined) {
      return { type: "subscribe", topic, sinceSeq: state.lastSeq };
    }
    return { type: "subscribe", topic };
  }

  function sendSubscribe(topic: string, state: TopicState): void {
    send(subscribeMessage(topic, state));
  }

  function clearReconnectTimer(): void {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function detachSocket(current: WebSocket): void {
    current.onopen = null;
    current.onmessage = null;
    current.onerror = null;
    current.onclose = null;
  }

  function closeSocket(): void {
    clearReconnectTimer();
    const current = socket;
    socket = null;
    if (!current) return;
    detachSocket(current);
    current.close();
  }

  function scheduleReconnect(): void {
    if (reconnectTimer || topics.size === 0) return;
    const delay = backoffMs;
    backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function handleMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn("ignoring malformed ws message:", raw, err);
      }
      return;
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { type?: unknown }).type !== "string"
    ) {
      if (import.meta.env.DEV) {
        console.warn("ignoring malformed ws message:", raw);
      }
      return;
    }
    const msg = parsed as UpstreamMessage;
    if (msg.type === "event") {
      if (typeof msg.topic !== "string" || typeof msg.seq !== "number") return;
      const state = topics.get(msg.topic);
      if (!state) return;
      state.lastSeq = msg.seq;
      options.onMessage(msg);
      return;
    }
    if (msg.type === "reset") {
      if (typeof msg.topic !== "string") return;
      const state = topics.get(msg.topic);
      if (!state) return;
      state.lastSeq = undefined;
      options.onMessage(msg);
    }
  }

  function connect(): void {
    if (topics.size === 0) return;
    if (
      socket &&
      (socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const ws = new WebSocket(options.wsUrl());
    socket = ws;

    ws.onopen = () => {
      if (socket !== ws) return;
      backoffMs = BACKOFF_INITIAL_MS;
      for (const [topic, state] of topics) {
        sendSubscribe(topic, state);
      }
    };

    ws.onmessage = (event) => {
      if (socket !== ws) return;
      handleMessage(String(event.data));
    };

    ws.onerror = () => {
      // `close` follows and schedules reconnect; nothing else to do here.
    };

    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null;
      if (topics.size === 0) return;
      scheduleReconnect();
    };
  }

  function applyHeldSeq(state: TopicState, seq: number): void {
    if (state.lastSeq === undefined || seq > state.lastSeq) {
      state.lastSeq = seq;
    }
  }

  return {
    acquire(topic: string, sinceSeq?: number): void {
      let state = topics.get(topic);
      const isNew = !state;
      if (!state) {
        state = { refs: 0 };
        topics.set(topic, state);
      }
      state.refs += 1;
      if (sinceSeq !== undefined) {
        applyHeldSeq(state, sinceSeq);
      }

      if (isNew) {
        if (socket?.readyState === WebSocket.OPEN) {
          sendSubscribe(topic, state);
        } else {
          connect();
        }
      }
    },

    release(topic: string): void {
      const state = topics.get(topic);
      if (!state) return;
      state.refs -= 1;
      if (state.refs > 0) return;
      topics.delete(topic);
      if (socket?.readyState === WebSocket.OPEN) {
        send({ type: "unsubscribe", topic });
      }
      if (topics.size === 0) {
        closeSocket();
        backoffMs = BACKOFF_INITIAL_MS;
      }
    },

    holdSeq(topic: string, seq: number): void {
      const state = topics.get(topic);
      if (!state) return;
      applyHeldSeq(state, seq);
    },

    close(): void {
      clearReconnectTimer();
      topics.clear();
      closeSocket();
    },

    resetForTests(): void {
      clearReconnectTimer();
      backoffMs = BACKOFF_INITIAL_MS;
      topics.clear();
      closeSocket();
    },
  };
}
