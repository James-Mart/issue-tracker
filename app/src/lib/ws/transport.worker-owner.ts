/**
 * SharedWorker-side transport owner: one upstream connection, topics
 * ref-counted across attached MessagePorts.
 */

import {
  createUpstreamConnection,
  type UpstreamConnection,
  type UpstreamMessage,
} from "./transport.socket";

export type PortToWorkerMessage =
  | { type: "hello"; version: number }
  | { type: "subscribe"; topic: string; sinceSeq?: number }
  | { type: "unsubscribe"; topic: string };

export type WorkerToPortMessage = UpstreamMessage;

/** Minimal port surface so unit tests can drive the owner with fakes. */
export type TransportWorkerPort = {
  postMessage(message: WorkerToPortMessage): void;
  addEventListener(
    type: "message" | "close",
    listener: (event: MessageEvent | Event) => void,
  ): void;
  start?: () => void;
  close(): void;
};

export type TransportWorkerOwner = {
  attachPort(port: TransportWorkerPort): void;
  resetForTests(): void;
};

export function createTransportWorkerOwner(options: {
  wsUrl: () => string;
  version: number;
  onShutdown?: () => void;
}): TransportWorkerOwner {
  /** topic → ports currently subscribed to it */
  const topicPorts = new Map<string, Set<TransportWorkerPort>>();
  /** port → topics it holds (for disconnect cleanup) */
  const portTopics = new Map<TransportWorkerPort, Set<string>>();

  let upstream: UpstreamConnection | null = null;
  let shutDown = false;

  function ensureUpstream(): UpstreamConnection {
    if (upstream) return upstream;
    upstream = createUpstreamConnection({
      wsUrl: options.wsUrl,
      onMessage: fanoutToPorts,
    });
    return upstream;
  }

  function fanoutToPorts(message: UpstreamMessage): void {
    const ports = topicPorts.get(message.topic);
    if (!ports) return;
    for (const port of ports) {
      port.postMessage(message);
    }
  }

  function subscribePort(
    port: TransportWorkerPort,
    topic: string,
    sinceSeq?: number,
  ): void {
    let ports = topicPorts.get(topic);
    const topics = portTopics.get(port);
    if (!topics) return;

    if (ports?.has(port)) {
      // Already attached — refresh held seq for upstream reconnect.
      if (sinceSeq !== undefined) {
        ensureUpstream().holdSeq(topic, sinceSeq);
      }
      return;
    }

    if (!ports) {
      ports = new Set();
      topicPorts.set(topic, ports);
    }
    const isFirst = ports.size === 0;
    ports.add(port);
    topics.add(topic);

    if (isFirst) {
      ensureUpstream().acquire(topic, sinceSeq);
    } else if (sinceSeq !== undefined) {
      ensureUpstream().holdSeq(topic, sinceSeq);
    }
  }

  function unsubscribePort(port: TransportWorkerPort, topic: string): void {
    const ports = topicPorts.get(topic);
    const topics = portTopics.get(port);
    if (!ports?.has(port)) return;

    ports.delete(port);
    topics?.delete(topic);

    if (ports.size > 0) return;
    topicPorts.delete(topic);
    upstream?.release(topic);
  }

  function detachPort(port: TransportWorkerPort): void {
    const topics = portTopics.get(port);
    if (!topics) return;
    for (const topic of [...topics]) {
      unsubscribePort(port, topic);
    }
    portTopics.delete(port);
  }

  function shutDownWorker(): void {
    if (shutDown) return;
    shutDown = true;
    upstream?.close();
    upstream = null;
    const ports = [...portTopics.keys()];
    topicPorts.clear();
    portTopics.clear();
    for (const port of ports) {
      port.close();
    }
    options.onShutdown?.();
  }

  return {
    attachPort(port: TransportWorkerPort): void {
      if (shutDown || portTopics.has(port)) return;
      portTopics.set(port, new Set());
      port.start?.();

      port.addEventListener("message", (event) => {
        if (shutDown) return;
        const msg = (event as MessageEvent).data as PortToWorkerMessage;
        if (!msg || typeof msg !== "object" || typeof msg.type !== "string") {
          return;
        }
        if (msg.type === "hello") {
          if (typeof msg.version !== "number") return;
          if (msg.version > options.version) {
            shutDownWorker();
          }
          return;
        }
        if (msg.type === "subscribe") {
          if (typeof msg.topic !== "string") return;
          subscribePort(port, msg.topic, msg.sinceSeq);
          return;
        }
        if (msg.type === "unsubscribe") {
          if (typeof msg.topic !== "string") return;
          unsubscribePort(port, msg.topic);
        }
      });

      port.addEventListener("close", () => {
        if (shutDown) return;
        detachPort(port);
      });
    },

    resetForTests(): void {
      shutDown = false;
      topicPorts.clear();
      portTopics.clear();
      upstream?.resetForTests();
      upstream = null;
    },
  };
}
