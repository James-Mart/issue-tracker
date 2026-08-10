// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTransportWorkerOwner,
  type TransportWorkerPort,
  type WorkerToPortMessage,
} from "./transport.worker-owner";
import { FakeWebSocket } from "./websocket.fake";

type FakeListener = (event: Event) => void;

class FakePort implements TransportWorkerPort {
  readonly posted: WorkerToPortMessage[] = [];
  private readonly listeners = new Map<string, Set<FakeListener>>();
  private started = false;

  postMessage(message: WorkerToPortMessage): void {
    this.posted.push(message);
  }

  addEventListener(
    type: "message" | "close",
    listener: (event: MessageEvent | Event) => void,
  ): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener as FakeListener);
  }

  start(): void {
    this.started = true;
  }

  get isStarted(): boolean {
    return this.started;
  }

  /** Deliver a port→worker message as the real MessagePort would. */
  deliver(data: unknown): void {
    const event = { data } as MessageEvent;
    for (const listener of this.listeners.get("message") ?? []) {
      listener(event);
    }
  }

  /** Simulate the browsing context going away. */
  disconnect(): void {
    const event = new Event("close");
    for (const listener of this.listeners.get("close") ?? []) {
      listener(event);
    }
  }
}

describe("SharedWorker transport owner ref counting", () => {
  let owner: ReturnType<typeof createTransportWorkerOwner>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket);
    FakeWebSocket.reset();
    owner = createTransportWorkerOwner({
      wsUrl: () => "ws://test.example/api/ws",
    });
  });

  afterEach(() => {
    owner.resetForTests();
    FakeWebSocket.reset();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("subscribing twice to one topic yields one upstream subscription", () => {
    const portA = new FakePort();
    const portB = new FakePort();
    owner.attachPort(portA);
    owner.attachPort(portB);

    portA.deliver({ type: "subscribe", topic: "issues" });
    expect(FakeWebSocket.instances).toHaveLength(1);
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();
    expect(ws.sent).toEqual([{ type: "subscribe", topic: "issues" }]);

    portB.deliver({ type: "subscribe", topic: "issues" });
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(ws.sent).toEqual([{ type: "subscribe", topic: "issues" }]);
    expect(ws.isClosed).toBe(false);
  });

  it("releases the topic upstream only when the last port unsubscribes", () => {
    const portA = new FakePort();
    const portB = new FakePort();
    owner.attachPort(portA);
    owner.attachPort(portB);

    portA.deliver({ type: "subscribe", topic: "conversation:a" });
    portB.deliver({ type: "subscribe", topic: "conversation:a" });
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();
    ws.sent.length = 0;

    portA.deliver({ type: "unsubscribe", topic: "conversation:a" });
    expect(ws.sent).toEqual([]);
    expect(ws.isClosed).toBe(false);

    portB.deliver({ type: "unsubscribe", topic: "conversation:a" });
    expect(ws.sent).toEqual([
      { type: "unsubscribe", topic: "conversation:a" },
    ]);
    expect(ws.isClosed).toBe(true);
  });

  it("releases the topic when the last holding port disconnects", () => {
    const portA = new FakePort();
    const portB = new FakePort();
    owner.attachPort(portA);
    owner.attachPort(portB);

    portA.deliver({ type: "subscribe", topic: "issues" });
    portB.deliver({ type: "subscribe", topic: "issues" });
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();
    ws.sent.length = 0;

    portA.disconnect();
    expect(ws.sent).toEqual([]);
    expect(ws.isClosed).toBe(false);

    portB.disconnect();
    expect(ws.sent).toEqual([{ type: "unsubscribe", topic: "issues" }]);
    expect(ws.isClosed).toBe(true);
  });

  it("fans upstream events out to every port subscribed to the topic", () => {
    const portA = new FakePort();
    const portB = new FakePort();
    const portC = new FakePort();
    owner.attachPort(portA);
    owner.attachPort(portB);
    owner.attachPort(portC);

    portA.deliver({ type: "subscribe", topic: "issues" });
    portB.deliver({ type: "subscribe", topic: "issues" });
    portC.deliver({ type: "subscribe", topic: "conversation:x" });

    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();
    ws.emitMessage({
      type: "event",
      topic: "issues",
      seq: 3,
      event: { type: "invalidate" },
    });

    const expected = {
      type: "event" as const,
      topic: "issues",
      seq: 3,
      event: { type: "invalidate" },
    };
    expect(portA.posted).toEqual([expected]);
    expect(portB.posted).toEqual([expected]);
    expect(portC.posted).toEqual([]);
  });
});
