// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ConversationTranscriptPage } from "@server/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentsKeys } from "../api/keys";
import { resetConversationEventsRegistryForTests } from "../lib/conversation-events-registry";
import { resetTransportForTests } from "@/lib/ws/transport";
import { FakeWebSocket } from "@/lib/ws/websocket.fake";
import {
  useConversationEvents,
  type ConversationEventsState,
} from "./use-conversation-events";

function Probe({
  conversationId,
  onState,
}: {
  conversationId: string;
  onState: (state: ConversationEventsState) => void;
}) {
  const state = useConversationEvents(conversationId);
  onState(state);
  return null;
}

function mountConsumer(
  conversationId: string,
  seed: ConversationTranscriptPage = { events: [], latestSeq: 0 },
): {
  root: Root;
  container: HTMLDivElement;
  client: QueryClient;
  getState: () => ConversationEventsState;
  rerender: (
    conversationId: string,
    seed?: ConversationTranscriptPage,
  ) => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let state!: ConversationEventsState;
  let currentId = conversationId;
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
    },
  });
  client.setQueryData(agentsKeys.transcript(conversationId), seed);
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
