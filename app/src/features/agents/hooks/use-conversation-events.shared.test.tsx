// @vitest-environment happy-dom
import { act } from "react";
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
import { createQueryClient } from "@/lib/query/client";
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
  const state = useConversationEvents(conversationId);
  onState(state);
  return null;
}

function mountConsumer(
  conversationId: string,
  seed: ConversationTranscriptPage | null = { events: [], latestSeq: 0 },
  client: QueryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
    },
  }),
): {
  root: Root;
  container: HTMLDivElement;
  client: QueryClient;
  getState: () => ConversationEventsView;
  rerender: (
    conversationId: string,
    seed?: ConversationTranscriptPage,
  ) => void;
} {
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
    rerender: (nextId: string, nextSeed = { events: [], latestSeq: 0 }) => {
      currentId = nextId;
      client.setQueryData(agentsKeys.transcript(nextId), nextSeed);
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

  it("seeds registry state from the transcript query before stream deltas", () => {
    const consumer = mountConsumer("conv-seed", {
      events: [
        {
          type: "prompt",
          text: "from history",
          at: "2026-08-10T00:00:00.000Z",
          seq: 1,
        },
      ],
      latestSeq: 1,
    });

    expect(consumer.getState().ready).toBe(true);
    expect(consumer.getState().historyFailed).toBe(false);
    expect(consumer.getState().events).toEqual([
      {
        type: "prompt",
        text: "from history",
        at: "2026-08-10T00:00:00.000Z",
        seq: 1,
      },
    ]);

    const ws = openAndSubscribe();
    expect(ws.sent).toEqual([
      { type: "subscribe", topic: "conversation:conv-seed", sinceSeq: 1 },
    ]);

    act(() => {
      ws.emitMessage({
        type: "event",
        topic: "conversation:conv-seed",
        seq: 2,
        event: {
          type: "assistant",
          text: "delta",
          at: "2026-08-10T00:00:01.000Z",
          seq: 2,
        },
      });
    });

    expect(consumer.getState().events).toEqual([
      {
        type: "prompt",
        text: "from history",
        at: "2026-08-10T00:00:00.000Z",
        seq: 1,
      },
      {
        type: "assistant",
        text: "delta",
        at: "2026-08-10T00:00:01.000Z",
        seq: 2,
      },
    ]);

    unmountConsumer(consumer);
  });

  it("opens one topic subscription per distinct conversation id on one socket", () => {
    const a = mountConsumer("conv-1");
    const b = mountConsumer("conv-2");

    expect(FakeWebSocket.instances).toHaveLength(1);
    const ws = openAndSubscribe();
    expect(ws.sent).toEqual([
      { type: "subscribe", topic: "conversation:conv-1" },
      { type: "subscribe", topic: "conversation:conv-2" },
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

  it("does not treat an in-flight transcript GET as failed before the deadline", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const consumer = mountConsumer("conv-hang", null);

    await flushQueryNotifications();
    expect(consumer.getState().ready).toBe(false);
    expect(consumer.getState().historyFailed).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TRANSCRIPT_FETCH_TIMEOUT_MS - 1);
    });
    await flushQueryNotifications();

    expect(consumer.getState().ready).toBe(false);
    expect(consumer.getState().historyFailed).toBe(false);

    unmountConsumer(consumer);
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

  it("seeds the thread from a successful transcript GET", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            events: [
              {
                type: "prompt",
                text: "from GET",
                at: "2026-08-10T00:00:00.000Z",
                seq: 1,
              },
            ],
            latestSeq: 1,
          }),
      }),
    );
    const consumer = mountConsumer("conv-ok", null);

    await flushQueryNotifications();

    expect(consumer.getState().ready).toBe(true);
    expect(consumer.getState().historyFailed).toBe(false);
    expect(consumer.getState().events).toEqual([
      {
        type: "prompt",
        text: "from GET",
        at: "2026-08-10T00:00:00.000Z",
        seq: 1,
      },
    ]);

    unmountConsumer(consumer);
  });

  it("sets historyFailed on an immediate HTTP error without waiting for the deadline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        text: async () => JSON.stringify({ error: "bad gateway" }),
      }),
    );
    const consumer = mountConsumer("conv-http", null);

    await flushQueryNotifications();

    expect(consumer.getState().ready).toBe(false);
    expect(consumer.getState().historyFailed).toBe(true);

    unmountConsumer(consumer);
  });

  it("surfaces historyFailed at 10s under app query defaults (retry: 1)", async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const consumer = mountConsumer(
      "conv-app-defaults",
      null,
      createQueryClient(),
    );
    await flushQueryNotifications();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TRANSCRIPT_FETCH_TIMEOUT_MS);
    });
    await flushQueryNotifications();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(consumer.getState().ready).toBe(false);
    expect(consumer.getState().historyFailed).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TRANSCRIPT_FETCH_TIMEOUT_MS + 1_000);
    });
    await flushQueryNotifications();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(consumer.getState().historyFailed).toBe(true);

    unmountConsumer(consumer);
  });
});
