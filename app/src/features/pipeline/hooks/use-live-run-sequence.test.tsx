// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TopicListener, TopicMessage } from "@/lib/ws/transport";
import type { RunSequence } from "../run-sequence";
import { AT_NESTED, inFlightSequence, sampleRun } from "../live-run-sequence.test-helpers";
import { useLiveRunSequence } from "./use-live-run-sequence";

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

function Probe({
  conversationId,
  fetched,
}: {
  conversationId?: string;
  fetched?: RunSequence;
}) {
  const live = useLiveRunSequence(conversationId, fetched);
  return (
    <div
      data-testid="live-sequence"
      data-condition={live?.condition ?? ""}
      data-beat-count={live?.beats.length ?? 0}
    >
      {live?.beats.map((row, index) => (
        <div
          key={`${row.label}-${index}`}
          data-testid="live-beat"
          data-label={row.label}
          data-parent={row.parentCallId ?? ""}
        />
      ))}
    </div>
  );
}

function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
    },
  });
}

function mount(
  props: { conversationId?: string; fetched?: RunSequence },
): {
  container: HTMLDivElement;
  root: Root;
  rerender: (next: { conversationId?: string; fetched?: RunSequence }) => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = testQueryClient();
  const tree = (next: typeof props): ReactNode => (
    <QueryClientProvider client={client}>
      <Probe {...next} />
    </QueryClientProvider>
  );
  act(() => {
    root.render(tree(props));
  });
  return {
    container,
    root,
    rerender: (next) => {
      act(() => {
        root.render(tree(next));
      });
    },
  };
}

function beatLabels(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll("[data-testid='live-beat']")).map(
    (node) => node.getAttribute("data-label"),
  );
}

function deliver(topic: string, message: TopicMessage) {
  const listener = topicState.listeners.get(topic);
  expect(listener).toBeTruthy();
  act(() => {
    listener!(message);
  });
}

function deliverDelegation(topic: string, seq: number) {
  deliver(topic, {
    type: "event",
    seq,
    event: {
      type: "delegation",
      run: sampleRun(),
      at: AT_NESTED,
      seq,
    },
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

describe("useLiveRunSequence", () => {
  it("drops overlaid frames when the conversation changes", () => {
    const { container, rerender } = mount({
      conversationId: "conv-a",
      fetched: inFlightSequence(),
    });

    deliverDelegation("conversation:conv-a", 10);
    expect(beatLabels(container)).toEqual([
      "spawn implementor",
      "spawn validator",
    ]);

    rerender({
      conversationId: "conv-b",
      fetched: inFlightSequence(),
    });

    expect(beatLabels(container)).toEqual(["spawn implementor"]);
  });

  it("clears overlaid frames on topic reset", () => {
    const { container } = mount({
      conversationId: "conv-live",
      fetched: inFlightSequence(),
    });

    deliverDelegation("conversation:conv-live", 10);
    deliver("conversation:conv-live", { type: "reset" });

    expect(beatLabels(container)).toEqual(["spawn implementor"]);
  });
});
