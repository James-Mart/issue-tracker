// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TopicListener } from "@/lib/ws/transport";
import { issuesKeys } from "./keys";
import { useProjectPrSync } from "./pr-sync-live";

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
  useProjectPrSync();
  return null;
}

function mount(): { root: Root; client: QueryClient } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity } },
  });
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
  });
  return { root, client };
}

function deliver(topic: string, message: Parameters<TopicListener>[0]): void {
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

describe("useProjectPrSync", () => {
  it("invalidates that project's PR cache when a pass finishes", () => {
    const { client } = mount();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    deliver("pr-sync", {
      type: "event",
      seq: 1,
      event: { type: "pr-sync", projectId: "platform" },
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: issuesKeys.projectPullRequests("platform"),
    });
  });
});
