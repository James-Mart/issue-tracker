// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TopicListener } from "@/lib/ws/transport";
import { pipelineKeys } from "./keys";
import { usePipelineRunsLive } from "./live";

const topicState = vi.hoisted(() => {
  const listeners = new Map<string, TopicListener>();
  return {
    listeners,
    subscribe: (topic: string, listener: TopicListener) => {
      listeners.set(topic, listener);
      return () => {
        listeners.delete(topic);
      };
    },
  };
});

vi.mock("@/lib/ws/transport", () => ({
  subscribeTopic: (topic: string, listener: TopicListener) =>
    topicState.subscribe(topic, listener),
}));

function Probe() {
  usePipelineRunsLive();
  return <div data-testid="pipeline-runs-live" />;
}

function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
    },
  });
}

function mount(): { root: Root; client: QueryClient } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = testQueryClient();
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
  });
  return { root, client };
}

function deliver(
  topic: string,
  message: Parameters<TopicListener>[0],
) {
  const listener = topicState.listeners.get(topic);
  expect(listener).toBeTruthy();
  act(() => {
    listener!(message);
  });
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  document.body.innerHTML = "";
  topicState.listeners.clear();
});

describe("usePipelineRunsLive", () => {
  it("subscribes to pipeline:runs and invalidates runs on a pipeline-run frame", async () => {
    const { client } = mount();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    expect(topicState.listeners.has("pipeline:runs")).toBe(true);

    deliver("pipeline:runs", {
      type: "event",
      seq: 1,
      event: {
        type: "pipeline-run",
        status: "started",
        conversationId: "conv-a",
        at: "2026-08-28T12:00:00.000Z",
        seq: 1,
      },
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: pipelineKeys.runs(),
    });
  });

  it("unsubscribes on unmount", () => {
    const { root } = mount();
    expect(topicState.listeners.has("pipeline:runs")).toBe(true);
    act(() => {
      root.unmount();
    });
    expect(topicState.listeners.has("pipeline:runs")).toBe(false);
  });
});
