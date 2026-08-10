// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  holdTopicSeq,
  resetTransportForTests,
  subscribeTopic,
  type TopicMessage,
} from "./transport";
import { FakeWebSocket } from "./websocket.fake";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  FakeWebSocket.reset();
  resetTransportForTests();
});

afterEach(() => {
  resetTransportForTests();
  FakeWebSocket.reset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function collect(messages: TopicMessage[]) {
  return (message: TopicMessage) => {
    messages.push(message);
  };
}

describe("subscribeTopic transport", () => {
  it("resubscribes held topics from the last delivered seq on reconnect", () => {
    const messages: TopicMessage[] = [];
    const unsubscribe = subscribeTopic("conversation:a", collect(messages));

    expect(FakeWebSocket.instances).toHaveLength(1);
    const first = FakeWebSocket.instances[0]!;
    first.emitOpen();
    expect(first.sent).toEqual([{ type: "subscribe", topic: "conversation:a" }]);

    first.emitMessage({
      type: "event",
      topic: "conversation:a",
      seq: 7,
      event: { type: "assistant", text: "hi" },
    });
    expect(messages).toEqual([
      { type: "event", seq: 7, event: { type: "assistant", text: "hi" } },
    ]);

    first.emitClose();
    expect(FakeWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(500);
    expect(FakeWebSocket.instances).toHaveLength(2);
    const second = FakeWebSocket.instances[1]!;
    second.emitOpen();

    expect(second.sent).toEqual([
      { type: "subscribe", topic: "conversation:a", sinceSeq: 7 },
    ]);

    unsubscribe();
  });

  it("includes a held history seq when resubscribing after reconnect", () => {
    const unsubscribe = subscribeTopic("conversation:b", () => {}, 3);

    const first = FakeWebSocket.instances[0]!;
    first.emitOpen();
    expect(first.sent).toEqual([
      { type: "subscribe", topic: "conversation:b", sinceSeq: 3 },
    ]);

    first.emitClose();
    vi.advanceTimersByTime(500);
    const second = FakeWebSocket.instances[1]!;
    second.emitOpen();
    expect(second.sent).toEqual([
      { type: "subscribe", topic: "conversation:b", sinceSeq: 3 },
    ]);

    unsubscribe();
  });

  it("fans out reset, clears held seq, and resubscribes without sinceSeq", () => {
    const messages: TopicMessage[] = [];
    const unsubscribe = subscribeTopic("conversation:c", collect(messages), 4);

    const first = FakeWebSocket.instances[0]!;
    first.emitOpen();
    first.sent.length = 0;

    first.emitMessage({ type: "reset", topic: "conversation:c" });
    expect(messages).toEqual([{ type: "reset" }]);

    first.emitClose();
    vi.advanceTimersByTime(500);
    const second = FakeWebSocket.instances[1]!;
    second.emitOpen();
    expect(second.sent).toEqual([
      { type: "subscribe", topic: "conversation:c" },
    ]);

    unsubscribe();
  });

  it("holdTopicSeq restores a baseline after reset", () => {
    const unsubscribe = subscribeTopic("conversation:d", () => {}, 9);
    const first = FakeWebSocket.instances[0]!;
    first.emitOpen();
    first.emitMessage({ type: "reset", topic: "conversation:d" });
    holdTopicSeq("conversation:d", 12);

    first.emitClose();
    vi.advanceTimersByTime(500);
    const second = FakeWebSocket.instances[1]!;
    second.emitOpen();
    expect(second.sent).toEqual([
      { type: "subscribe", topic: "conversation:d", sinceSeq: 12 },
    ]);

    unsubscribe();
  });

  it("opens one socket for two topics and unsubscribes when the last listener leaves", () => {
    const unsubA = subscribeTopic("conversation:a", () => {});
    const unsubB = subscribeTopic("issues", () => {});

    expect(FakeWebSocket.instances).toHaveLength(1);
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();
    expect(ws.sent).toEqual([
      { type: "subscribe", topic: "conversation:a" },
      { type: "subscribe", topic: "issues" },
    ]);

    unsubA();
    expect(ws.sent).toContainEqual({
      type: "unsubscribe",
      topic: "conversation:a",
    });
    expect(ws.isClosed).toBe(false);

    unsubB();
    expect(ws.isClosed).toBe(true);
  });
});
