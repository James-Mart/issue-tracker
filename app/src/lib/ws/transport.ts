/**
 * Browser transport client — the one module allowed to construct a WebSocket.
 * Components subscribe to topics; they never open a connection themselves.
 */

export type TopicEventMessage = {
  type: "event";
  seq: number;
  event: unknown;
};

export type TopicResetMessage = {
  type: "reset";
};

export type TopicMessage = TopicEventMessage | TopicResetMessage;

export type TopicListener = (message: TopicMessage) => void;

type ClientToServerMessage =
  | { type: "subscribe"; topic: string; sinceSeq?: number }
  | { type: "unsubscribe"; topic: string };

type ServerToClientMessage =
  | { type: "event"; topic: string; seq: number; event: unknown }
  | { type: "reset"; topic: string };

type TopicState = {
  listeners: Set<TopicListener>;
  /** Last seq held for this topic (delivered, or seeded from history). */
  lastSeq?: number;
};

const WS_PATH = "/api/ws";
const BACKOFF_INITIAL_MS = 500;
const BACKOFF_MAX_MS = 8_000;

const topics = new Map<string, TopicState>();

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let backoffMs = BACKOFF_INITIAL_MS;

function wsUrl(): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}${WS_PATH}`;
}

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
  const msg = parsed as ServerToClientMessage;
  if (msg.type === "event") {
    if (typeof msg.topic !== "string" || typeof msg.seq !== "number") return;
    const state = topics.get(msg.topic);
    if (!state) return;
    state.lastSeq = msg.seq;
    const fanout: TopicEventMessage = {
      type: "event",
      seq: msg.seq,
      event: msg.event,
    };
    for (const listener of state.listeners) {
      listener(fanout);
    }
    return;
  }
  if (msg.type === "reset") {
    if (typeof msg.topic !== "string") return;
    const state = topics.get(msg.topic);
    if (!state) return;
    state.lastSeq = undefined;
    const fanout: TopicResetMessage = { type: "reset" };
    for (const listener of state.listeners) {
      listener(fanout);
    }
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

  const ws = new WebSocket(wsUrl());
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

/**
 * Hold a baseline seq for a topic (history seed / post-reset reseed) so the
 * next subscribe — including reconnect — asks for frames after that seq.
 */
export function holdTopicSeq(topic: string, seq: number): void {
  const state = topics.get(topic);
  if (!state) return;
  if (state.lastSeq === undefined || seq > state.lastSeq) {
    state.lastSeq = seq;
  }
}

/**
 * Subscribe to a multiplexed topic on the shared WebSocket. The socket opens
 * lazily on the first subscription, reconnects with backoff, and resubscribes
 * every held topic with the last seq held for that topic.
 *
 * `heldSeq` is the seq already held for the topic (e.g. history `latestSeq`)
 * so the first subscribe and later reconnects can ask for the gap after it.
 */
export function subscribeTopic(
  topic: string,
  listener: TopicListener,
  heldSeq?: number,
): () => void {
  let state = topics.get(topic);
  const isNew = !state;
  if (!state) {
    state = { listeners: new Set() };
    topics.set(topic, state);
  }
  state.listeners.add(listener);
  if (heldSeq !== undefined) {
    if (state.lastSeq === undefined || heldSeq > state.lastSeq) {
      state.lastSeq = heldSeq;
    }
  }

  if (isNew) {
    if (socket?.readyState === WebSocket.OPEN) {
      sendSubscribe(topic, state);
    } else {
      connect();
    }
  }

  return () => {
    const current = topics.get(topic);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.listeners.size > 0) return;
    topics.delete(topic);
    if (socket?.readyState === WebSocket.OPEN) {
      send({ type: "unsubscribe", topic });
    }
    if (topics.size === 0) {
      closeSocket();
      backoffMs = BACKOFF_INITIAL_MS;
    }
  };
}

/** Tear down transport state — for tests that install a fake `WebSocket`. */
export function resetTransportForTests(): void {
  clearReconnectTimer();
  backoffMs = BACKOFF_INITIAL_MS;
  for (const state of topics.values()) {
    state.listeners.clear();
  }
  topics.clear();
  closeSocket();
}
