import type { Server } from "http";
import { WebSocketServer, type WebSocket } from "ws";
import {
  getFramesSince,
  subscribeFrames,
  type ConversationFrame,
} from "./conversation-stream.js";
import { ISSUES_TOPIC, startIssueEventsWatcher } from "./issue-events.js";

export type ClientToServerMessage =
  | { type: "subscribe"; topic: string; sinceSeq?: number }
  | { type: "unsubscribe"; topic: string };

export type ServerToClientMessage =
  | { type: "event"; topic: string; seq: number; event: unknown }
  | { type: "reset"; topic: string };

type ConnectionState = {
  socket: WebSocket;
  /** topic → unsubscribe from the frame seam */
  subscriptions: Map<string, () => void>;
};

const connections = new Set<ConnectionState>();

/**
 * Map a protocol topic onto the in-process frame-seam key.
 * `conversation:<id>` keeps publishing on the bare conversation id; every
 * other topic (including `issues`) uses the topic string as the key.
 */
export function streamKeyForTopic(topic: string): string | null {
  if (topic.startsWith("conversation:")) {
    const id = topic.slice("conversation:".length);
    return id.length > 0 ? id : null;
  }
  return topic.length > 0 ? topic : null;
}

export function getConnectionDiagnostics(): {
  connections: number;
  subscriptions: number;
} {
  let subscriptions = 0;
  for (const conn of connections) {
    subscriptions += conn.subscriptions.size;
  }
  return { connections: connections.size, subscriptions };
}

function send(socket: WebSocket, message: ServerToClientMessage): void {
  if (socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify(message));
}

function frameSeq(frame: ConversationFrame): number {
  const seq = frame.event.seq;
  if (typeof seq !== "number") {
    throw new Error("live frame missing seq");
  }
  return seq;
}

function unsubscribeTopic(conn: ConnectionState, topic: string): void {
  const unsub = conn.subscriptions.get(topic);
  if (!unsub) return;
  unsub();
  conn.subscriptions.delete(topic);
}

function subscribeTopic(
  conn: ConnectionState,
  topic: string,
  sinceSeq: number | undefined,
): void {
  const key = streamKeyForTopic(topic);
  if (key === null) return;
  if (key === ISSUES_TOPIC) startIssueEventsWatcher();

  unsubscribeTopic(conn, topic);

  if (sinceSeq !== undefined) {
    const catchup = getFramesSince(key, sinceSeq);
    if (catchup.resetRequired) {
      send(conn.socket, { type: "reset", topic });
    } else {
      for (const frame of catchup.frames) {
        send(conn.socket, {
          type: "event",
          topic,
          seq: frameSeq(frame),
          event: frame.event,
        });
      }
    }
  }

  const unsubscribe = subscribeFrames(key, (frame) => {
    send(conn.socket, {
      type: "event",
      topic,
      seq: frameSeq(frame),
      event: frame.event,
    });
  });
  conn.subscriptions.set(topic, unsubscribe);
}

function handleMessage(conn: ConnectionState, raw: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("invalid WebSocket JSON");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { type?: unknown }).type !== "string"
  ) {
    throw new Error("invalid WebSocket message");
  }
  const msg = parsed as ClientToServerMessage;
  if (msg.type === "subscribe") {
    if (typeof msg.topic !== "string") {
      throw new Error("subscribe requires topic");
    }
    if (
      msg.sinceSeq !== undefined &&
      (typeof msg.sinceSeq !== "number" ||
        !Number.isInteger(msg.sinceSeq) ||
        msg.sinceSeq < 0)
    ) {
      throw new Error("subscribe sinceSeq must be a non-negative integer");
    }
    subscribeTopic(conn, msg.topic, msg.sinceSeq);
    return;
  }
  if (msg.type === "unsubscribe") {
    if (typeof msg.topic !== "string") {
      throw new Error("unsubscribe requires topic");
    }
    unsubscribeTopic(conn, msg.topic);
    return;
  }
  throw new Error(`unknown WebSocket message type`);
}

function disposeConnection(conn: ConnectionState): void {
  if (!connections.delete(conn)) return;
  for (const topic of [...conn.subscriptions.keys()]) {
    unsubscribeTopic(conn, topic);
  }
}

/**
 * Attach the multiplexed `/api/ws` WebSocket endpoint to an HTTP server that
 * already serves the Express app.
 */
export function attachMultiplexedWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: "/api/ws" });

  wss.on("connection", (socket) => {
    const conn: ConnectionState = {
      socket,
      subscriptions: new Map(),
    };
    connections.add(conn);

    socket.on("message", (data) => {
      try {
        handleMessage(conn, String(data));
      } catch (err) {
        console.error("multiplexed ws message error:", err);
        socket.close(1003, "invalid message");
      }
    });

    socket.on("close", () => {
      disposeConnection(conn);
    });
  });

  server.on("close", () => {
    wss.close();
  });

  return wss;
}
