// @vitest-environment happy-dom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  notifyManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import type { ConversationTranscriptPage } from "@server/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentsKeys } from "../api/keys";
import { resetConversationEventsRegistryForTests } from "../lib/conversation-events-registry";
import { resetTransportForTests } from "@/lib/ws/transport";
import { FakeWebSocket } from "@/lib/ws/websocket.fake";
import { TRANSCRIPT_FETCH_TIMEOUT_MS } from "../api/client";
import {
  useConversationEvents,
  type ConversationEventsState,
} from "./use-conversation-events";

type ConversationEventsView = ConversationEventsState & {
  historyFailed: boolean;
};

function Probe({
  conversationId,
  onState,
}: {
  conversationId: string;
  onState: (state: ConversationEventsView) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const state = useConversationEvents(conversationId, hostRef);
  onState(state);
  return <div ref={hostRef} data-testid={`thread-host-${conversationId}`} />;
}

function mountConsumer(
  conversationId: string,
  seed: ConversationTranscriptPage | null = { events: [], latestSeq: 0 },
): {
  root: Root;
  container: HTMLDivElement;
  client: QueryClient;
  getState: () => ConversationEventsView;
  rerender: (conversationId: string) => void;
} {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
    },
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let state!: ConversationEventsView;
  let currentId = conversationId;
  if (seed) client.setQueryData(agentsKeys.transcript(conversationId), seed);
  const render = () => {
    act(() => {
      root.render(
        <QueryClientProvider client={client}>
          <Probe
            conversationId={currentId}
            onState={(next) => {
              state = next;
            }}
          />
        </QueryClientProvider>,
      );
    });
  };
  render();
  return {
    root,
    container,
    client,
    getState: () => state,
    rerender: (nextId: string) => {
      currentId = nextId;
      client.setQueryData(agentsKeys.transcript(nextId), {
        events: [],
        latestSeq: 0,
      });
      render();
    },
  };
}

function unmountConsumer(consumer: {
  root: Root;
  container: HTMLDivElement;
  client: QueryClient;
}): void {
  act(() => {
    consumer.root.unmount();
  });
  consumer.client.clear();
  consumer.container.remove();
}

function openAndSubscribe(ws: FakeWebSocket = FakeWebSocket.instances[0]!): FakeWebSocket {
  act(() => {
    ws.emitOpen();
  });
  return ws;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  // Keep reconnect timers from pinning the vitest worker open.
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  FakeWebSocket.reset();
  resetTransportForTests();
  resetConversationEventsRegistryForTests();
});

afterEach(() => {
  resetConversationEventsRegistryForTests();
  resetTransportForTests();
  FakeWebSocket.reset();
  vi.clearAllTimers();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("shared conversation subscription", () => {
  it("opens one WebSocket for two consumers and delivers the same events", () => {
    const a = mountConsumer("conv-1");
    const b = mountConsumer("conv-1");

    expect(FakeWebSocket.instances).toHaveLength(1);
    const ws = openAndSubscribe();
    expect(ws.sent).toEqual([
      { type: "subscribe", topic: "conversation:conv-1" },
    ]);

    act(() => {
      ws.emitMessage({
        type: "event",
        topic: "conversation:conv-1",
        seq: 1,
        event: {
          type: "prompt",
          text: "hello",
          at: "2026-08-10T00:00:00.000Z",
          seq: 1,
        },
      });
    });

    expect(a.getState().ready).toBe(true);
    expect(b.getState().ready).toBe(true);
    expect(a.getState().events).toEqual(b.getState().events);
    expect(a.getState().events).toEqual([
      {
        type: "prompt",
        text: "hello",
        at: "2026-08-10T00:00:00.000Z",
        seq: 1,
      },
    ]);

    unmountConsumer(a);
    unmountConsumer(b);
  });

  it("releases the old topic when a consumer switches ids", () => {
    const consumer = mountConsumer("conv-1");
    const first = openAndSubscribe();

    consumer.rerender("conv-2");

    expect(first.sent).toContainEqual({
      type: "unsubscribe",
      topic: "conversation:conv-1",
    });
    // Last topic leaving closes the socket; the new id opens another.
    expect(first.isClosed).toBe(true);
    expect(FakeWebSocket.instances).toHaveLength(2);
    const second = openAndSubscribe(FakeWebSocket.instances[1]!);
    expect(second.sent).toEqual([
      { type: "subscribe", topic: "conversation:conv-2" },
    ]);

    unmountConsumer(consumer);

    expect(second.isClosed).toBe(true);
  });
});

function hangingFetch(): ReturnType<typeof vi.fn> {
  return vi.fn((_input: string, init?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return;
      const fail = () => {
        queueMicrotask(() => {
          reject(
            Object.assign(new Error("The operation was aborted."), {
              name: "AbortError",
            }),
          );
        });
      };
      if (signal.aborted) {
        fail();
        return;
      }
      signal.addEventListener("abort", fail, { once: true });
    });
  });
}

async function flushQueryNotifications(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe("transcript fetch timeout and historyFailed", () => {
  beforeEach(() => {
    notifyManager.setScheduler((cb) => {
      cb();
    });
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), ms);
      return controller.signal;
    });
  });

  afterEach(() => {
    vi.mocked(AbortSignal.timeout).mockRestore();
    notifyManager.setScheduler((cb) => {
      setTimeout(cb, 0);
    });
  });

  it("aborts a hung transcript GET at 10s and leaves historyFailed true", async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const consumer = mountConsumer("conv-timeout", null);
    await flushQueryNotifications();
    expect(fetchMock).toHaveBeenCalled();
    const signal = fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal | undefined;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TRANSCRIPT_FETCH_TIMEOUT_MS);
    });
    await flushQueryNotifications();

    expect(signal?.aborted).toBe(true);
    expect(consumer.getState().ready).toBe(false);
    expect(consumer.getState().historyFailed).toBe(true);

    unmountConsumer(consumer);
  });
});

describe("steering frame", () => {
  it("shows a steering frame until the prompt arrives, or drops it for the same pending text", () => {
    const consumer = mountConsumer("conv-steer");
    const ws = openAndSubscribe();

    act(() => {
      ws.emitMessage({
        type: "event",
        topic: "conversation:conv-steer",
        seq: 1,
        event: {
          type: "steering",
          text: "Focus on v0.9",
          at: "2026-08-10T00:00:00.000Z",
          seq: 1,
        },
      });
    });

    expect(consumer.getState().steeringText).toBe("Focus on v0.9");
    expect(consumer.getState().events).toEqual([]);

    act(() => {
      ws.emitMessage({
        type: "event",
        topic: "conversation:conv-steer",
        seq: 2,
        event: {
          type: "prompt",
          text: "Focus on v0.9",
          at: "2026-08-10T00:00:01.000Z",
          seq: 2,
        },
      });
    });

    expect(consumer.getState().steeringText).toBeNull();
    expect(consumer.getState().events).toEqual([
      {
        type: "prompt",
        text: "Focus on v0.9",
        at: "2026-08-10T00:00:01.000Z",
        seq: 2,
      },
    ]);

    act(() => {
      ws.emitMessage({
        type: "event",
        topic: "conversation:conv-steer",
        seq: 3,
        event: {
          type: "steering",
          text: "queue instead",
          at: "2026-08-10T00:00:02.000Z",
          seq: 3,
        },
      });
    });
    act(() => {
      ws.emitMessage({
        type: "event",
        topic: "conversation:conv-steer",
        seq: 4,
        event: {
          type: "pending",
          text: "queue instead",
          at: "2026-08-10T00:00:03.000Z",
          seq: 4,
        },
      });
    });

    expect(consumer.getState().steeringText).toBeNull();
    expect(consumer.getState().pendingText).toBe("queue instead");
    expect(consumer.getState().pendingSteerFallback).toBe(true);

    unmountConsumer(consumer);
  });
});
