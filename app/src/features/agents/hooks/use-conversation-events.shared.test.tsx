// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ConversationTranscriptPage } from "@server/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentsKeys } from "../api/keys";
import { FakeEventSource } from "../event-source.fake";
import { resetConversationEventsRegistryForTests } from "../lib/conversation-events-registry";
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

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  // Keep heartbeat/reconnect timers from pinning the vitest worker open.
  vi.useFakeTimers();
  vi.stubGlobal("EventSource", FakeEventSource);
  FakeEventSource.reset();
  resetConversationEventsRegistryForTests();
});

afterEach(() => {
  resetConversationEventsRegistryForTests();
  FakeEventSource.reset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("shared conversation subscription", () => {
  it("opens one EventSource for two consumers and delivers the same events", () => {
    const a = mountConsumer("conv-1");
    const b = mountConsumer("conv-1");

    expect(FakeEventSource.instances).toHaveLength(1);
    const source = FakeEventSource.instances[0]!;
    expect(source.url).toBe("/api/conversations/conv-1/events");

    act(() => {
      source.emitOpen();
      source.emitMessage({
        type: "prompt",
        text: "hello",
        at: "2026-08-10T00:00:00.000Z",
        seq: 1,
      });
      source.emitPing();
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

    const source = FakeEventSource.instances[0]!;
    act(() => {
      source.emitMessage({
        type: "assistant",
        text: "delta",
        at: "2026-08-10T00:00:01.000Z",
        seq: 2,
      });
      source.emitPing();
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

  it("opens one EventSource per distinct conversation id", () => {
    const a = mountConsumer("conv-1");
    const b = mountConsumer("conv-2");

    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[0]!.url).toBe(
      "/api/conversations/conv-1/events",
    );
    expect(FakeEventSource.instances[1]!.url).toBe(
      "/api/conversations/conv-2/events",
    );

    unmountConsumer(a);
    unmountConsumer(b);
  });

  it("closes the old subscription when a consumer switches ids", () => {
    const consumer = mountConsumer("conv-1");
    const firstSource = FakeEventSource.instances[0]!;

    consumer.rerender("conv-2");

    expect(FakeEventSource.instances).toHaveLength(2);
    expect(firstSource.isClosed).toBe(true);
    expect(FakeEventSource.instances[1]!.isClosed).toBe(false);

    unmountConsumer(consumer);

    expect(FakeEventSource.instances[1]!.isClosed).toBe(true);
  });
});
