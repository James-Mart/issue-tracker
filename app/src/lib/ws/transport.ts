/**
 * Browser transport client. Components subscribe to topics; they never open a
 * connection themselves. When SharedWorker is available the tab attaches over a
 * MessagePort; otherwise it uses the direct upstream socket module.
 */

import {
  createUpstreamConnection,
  type UpstreamConnection,
  type UpstreamMessage,
} from "./transport.socket";
import type { WorkerToPortMessage } from "./transport.worker-owner";

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

type TopicState = {
  listeners: Set<TopicListener>;
  /** Last seq held for this topic (delivered, or seeded from history). */
  lastSeq?: number;
};

const WS_PATH = "/api/ws";

const topics = new Map<string, TopicState>();

function sharedWorkerAvailable(): boolean {
  return typeof SharedWorker !== "undefined";
}

function wsUrl(): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}${WS_PATH}`;
}

// --- Direct path (no SharedWorker) -----------------------------------------

let directUpstream: UpstreamConnection | null = null;

function handleDirectUpstream(message: UpstreamMessage): void {
  const state = topics.get(message.topic);
  if (!state) return;
  if (message.type === "event") {
    state.lastSeq = message.seq;
    const fanout: TopicEventMessage = {
      type: "event",
      seq: message.seq,
      event: message.event,
    };
    for (const listener of state.listeners) {
      listener(fanout);
    }
    return;
  }
  state.lastSeq = undefined;
  const fanout: TopicResetMessage = { type: "reset" };
  for (const listener of state.listeners) {
    listener(fanout);
  }
}

function getDirectUpstream(): UpstreamConnection {
  if (!directUpstream) {
    directUpstream = createUpstreamConnection({
      wsUrl,
      onMessage: handleDirectUpstream,
    });
  }
  return directUpstream;
}

function subscribeDirect(
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
    getDirectUpstream().acquire(topic, state.lastSeq);
  }

  return () => {
    const current = topics.get(topic);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.listeners.size > 0) return;
    topics.delete(topic);
    directUpstream?.release(topic);
  };
}

function holdDirectSeq(topic: string, seq: number): void {
  const state = topics.get(topic);
  if (!state) return;
  if (state.lastSeq === undefined || seq > state.lastSeq) {
    state.lastSeq = seq;
  }
  directUpstream?.holdSeq(topic, seq);
}

// --- SharedWorker path -----------------------------------------------------

let sharedWorker: SharedWorker | null = null;
let workerPort: MessagePort | null = null;
/** True while reconnecting after a stale worker shut down. */
let reconnectingWorker = false;

function handleWorkerMessage(message: WorkerToPortMessage): void {
  const state = topics.get(message.topic);
  if (!state) return;
  if (message.type === "event") {
    state.lastSeq = message.seq;
    const fanout: TopicEventMessage = {
      type: "event",
      seq: message.seq,
      event: message.event,
    };
    for (const listener of state.listeners) {
      listener(fanout);
    }
    return;
  }
  state.lastSeq = undefined;
  const fanout: TopicResetMessage = { type: "reset" };
  for (const listener of state.listeners) {
    listener(fanout);
  }
}

function resubscribeAllViaWorker(port: MessagePort): void {
  for (const [topic, state] of topics) {
    if (state.lastSeq !== undefined) {
      port.postMessage({
        type: "subscribe",
        topic,
        sinceSeq: state.lastSeq,
      });
    } else {
      port.postMessage({ type: "subscribe", topic });
    }
  }
}

function handleWorkerPortClosed(): void {
  if (reconnectingWorker) return;
  workerPort = null;
  sharedWorker = null;
  if (topics.size === 0) return;
  reconnectingWorker = true;
  try {
    const port = ensureWorkerPort();
    resubscribeAllViaWorker(port);
  } finally {
    reconnectingWorker = false;
  }
}

function ensureWorkerPort(): MessagePort {
  if (workerPort) return workerPort;
  const url = new URL("./transport.shared-worker.ts", import.meta.url);
  url.searchParams.set("v", String(__TRANSPORT_VERSION__));
  sharedWorker = new SharedWorker(url, {
    type: "module",
    name: "issue-tracker-transport",
  });
  workerPort = sharedWorker.port;
  workerPort.onmessage = (event: MessageEvent<WorkerToPortMessage>) => {
    handleWorkerMessage(event.data);
  };
  workerPort.addEventListener("close", () => {
    handleWorkerPortClosed();
  });
  workerPort.start();
  workerPort.postMessage({
    type: "hello",
    version: __TRANSPORT_VERSION__,
  });
  return workerPort;
}

function subscribeViaWorker(
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
    const port = ensureWorkerPort();
    if (state.lastSeq !== undefined) {
      port.postMessage({
        type: "subscribe",
        topic,
        sinceSeq: state.lastSeq,
      });
    } else {
      port.postMessage({ type: "subscribe", topic });
    }
  }

  return () => {
    const current = topics.get(topic);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.listeners.size > 0) return;
    topics.delete(topic);
    workerPort?.postMessage({ type: "unsubscribe", topic });
  };
}

function holdWorkerSeq(topic: string, seq: number): void {
  const state = topics.get(topic);
  if (!state) return;
  if (state.lastSeq === undefined || seq > state.lastSeq) {
    state.lastSeq = seq;
  }
  // Refresh the worker's held seq for upstream reconnect (same subscribe msg).
  workerPort?.postMessage({ type: "subscribe", topic, sinceSeq: seq });
}

// --- Public API ------------------------------------------------------------

/**
 * Hold a baseline seq for a topic (history seed / post-reset reseed) so the
 * next subscribe — including reconnect — asks for frames after that seq.
 */
export function holdTopicSeq(topic: string, seq: number): void {
  if (sharedWorkerAvailable()) {
    holdWorkerSeq(topic, seq);
    return;
  }
  holdDirectSeq(topic, seq);
}

/**
 * Subscribe to a multiplexed topic on the shared WebSocket. The socket opens
 * lazily on the first subscription, reconnects with backoff, and resubscribes
 * every held topic with the last seq held for that topic.
 *
 * When `SharedWorker` is available the connection lives in the worker and this
 * tab attaches over a MessagePort; otherwise the tab owns the socket directly.
 *
 * `heldSeq` is the seq already held for the topic (e.g. history `latestSeq`)
 * so the first subscribe and later reconnects can ask for the gap after it.
 */
export function subscribeTopic(
  topic: string,
  listener: TopicListener,
  heldSeq?: number,
): () => void {
  if (sharedWorkerAvailable()) {
    return subscribeViaWorker(topic, listener, heldSeq);
  }
  return subscribeDirect(topic, listener, heldSeq);
}

/** Tear down transport state — for tests that install a fake `WebSocket`. */
export function resetTransportForTests(): void {
  for (const state of topics.values()) {
    state.listeners.clear();
  }
  topics.clear();
  directUpstream?.resetForTests();
  directUpstream = null;
  reconnectingWorker = false;
  if (workerPort) {
    workerPort.close();
    workerPort = null;
  }
  sharedWorker = null;
}
