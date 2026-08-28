// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRun } from "@server/schemas";
import type { TopicListener, TopicMessage } from "@/lib/ws/transport";
import type { RunSequence, SequenceBeat } from "../run-sequence";
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

const AT = "2026-08-28T12:00:00.000Z";
const AT_NESTED = "2026-08-28T12:00:12.000Z";
const AT_END = "2026-08-28T12:00:20.000Z";

function beat(partial: SequenceBeat): SequenceBeat {
  return partial;
}

function sequence(
  condition: RunSequence["condition"],
  conversationBeats?: SequenceBeat[],
): RunSequence {
  return {
    condition,
    lifelines: [
      { id: "coordinator", label: "implementing", kind: "coordinator" },
      { id: "implementor", label: "implementor", kind: "role" },
    ],
    beats:
      conversationBeats ??
      [
        beat({
          from: "coordinator",
          to: "implementor",
          label: "spawn implementor",
          startedAt: AT,
          kind: "spawn",
          parentCallId: "call-impl",
          ...(condition !== "in-flight" ? { durationMs: 20_000 } : {}),
        }),
      ],
  };
}

function sampleRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    delegationId: "del-qa",
    agentId: "agent-qa",
    role: "validator",
    model: "composer-2.5",
    issueId: "run-live-updates",
    parentCallId: "call-qa",
    conversationId: "conv-live",
    startedAt: AT_NESTED,
    status: "running",
    isResume: false,
    ...overrides,
  };
}

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

function deliver(topic: string, message: TopicMessage) {
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

describe("useLiveRunSequence", () => {
  it("appends a beat when a delegation frame arrives on an in-flight run", () => {
    const { container } = mount({
      conversationId: "conv-live",
      fetched: sequence("in-flight"),
    });
    expect(topicState.listeners.has("conversation:conv-live")).toBe(true);

    deliver("conversation:conv-live", {
      type: "event",
      seq: 10,
      event: {
        type: "delegation",
        run: sampleRun(),
        at: AT_NESTED,
        seq: 10,
      },
    });

    expect(
      Array.from(container.querySelectorAll("[data-testid='live-beat']")).map(
        (node) => node.getAttribute("data-label"),
      ),
    ).toEqual(["spawn implementor", "spawn validator"]);
    expect(
      container.querySelector("[data-testid='live-sequence']")?.getAttribute(
        "data-condition",
      ),
    ).toBe("in-flight");
  });

  it("flips the condition and unsubscribes when the run ends", () => {
    const { container } = mount({
      conversationId: "conv-live",
      fetched: sequence("in-flight"),
    });

    deliver("conversation:conv-live", {
      type: "event",
      seq: 12,
      event: {
        type: "delegation_end",
        delegationId: "del-impl",
        parentCallId: "call-impl",
        status: "completed",
        endedAt: AT_END,
        at: AT_END,
        seq: 12,
      },
    });

    expect(
      container.querySelector("[data-testid='live-sequence']")?.getAttribute(
        "data-condition",
      ),
    ).toBe("completed");
    expect(topicState.listeners.has("conversation:conv-live")).toBe(false);
  });

  it("unsubscribes on unmount", () => {
    const { root } = mount({
      conversationId: "conv-live",
      fetched: sequence("in-flight"),
    });
    expect(topicState.listeners.has("conversation:conv-live")).toBe(true);
    act(() => {
      root.unmount();
    });
    expect(topicState.listeners.has("conversation:conv-live")).toBe(false);
  });

  it("unsubscribes the previous run when another run is selected", () => {
    const { rerender } = mount({
      conversationId: "conv-a",
      fetched: sequence("in-flight"),
    });
    expect(topicState.listeners.has("conversation:conv-a")).toBe(true);

    rerender({
      conversationId: "conv-b",
      fetched: sequence("in-flight"),
    });

    expect(topicState.listeners.has("conversation:conv-a")).toBe(false);
    expect(topicState.listeners.has("conversation:conv-b")).toBe(true);
  });

  it("never subscribes to a completed run", () => {
    mount({
      conversationId: "conv-done",
      fetched: sequence("completed"),
    });
    expect(topicState.listeners.has("conversation:conv-done")).toBe(false);
  });

  it("never subscribes to a failed run", () => {
    mount({
      conversationId: "conv-fail",
      fetched: sequence("failed"),
    });
    expect(topicState.listeners.has("conversation:conv-fail")).toBe(false);
  });
});
