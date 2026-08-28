// @vitest-environment happy-dom
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentRun, TranscriptEvent } from "@server/schemas";
import type { TopicListener, TopicMessage } from "@/lib/ws/transport";
import { issuesKeys } from "../api/keys";
import { AgentRunCard, AgentRunsPanel } from "./agent-runs-panel";

const queryState = vi.hoisted(() => ({
  data: {
    runs: [] as AgentRun[],
    workRoot: undefined as
      | { issueId: string; conversationId: string }
      | undefined,
  },
  isLoading: false,
  error: null as Error | null,
}));

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

const eventsQueryState = vi.hoisted(() => ({
  data: { events: [] as TranscriptEvent[] },
  isLoading: false,
  error: null as Error | null,
  expandedCalls: [] as string[],
}));

vi.mock("../api/queries", () => ({
  useIssueAgentRunsQuery: () => ({
    data: queryState.data,
    isLoading: queryState.isLoading,
    error: queryState.error,
  }),
  useIssueAgentRunEventsQuery: (
    _issueId: string,
    delegationId: string,
    expanded: boolean,
  ) => {
    if (expanded) {
      eventsQueryState.expandedCalls.push(delegationId);
    }
    return {
      data: expanded ? eventsQueryState.data : undefined,
      isLoading: expanded && eventsQueryState.isLoading,
      error: expanded ? eventsQueryState.error : null,
    };
  },
}));

const AT = "2026-07-09T14:00:00.000Z";
const AT_MID = "2026-07-09T15:00:00.000Z";
const AT_END = "2026-07-09T16:00:00.000Z";

function sampleRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    delegationId: "del-1",
    agentId: "agent-1",
    role: "issue-tracker-implementor",
    model: "composer-2.5",
    issueId: "task-1",
    parentCallId: "call-1",
    conversationId: "conv-1",
    startedAt: AT,
    status: "completed",
    endedAt: AT_END,
    isResume: false,
    ...overrides,
  };
}

function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
    },
  });
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname}</div>;
}

function panelTree(panel: ReactNode, client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Routes>
          <Route
            path="*"
            element={
              <>
                {panel}
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function mountPanel(props: ComponentProps<typeof AgentRunsPanel>): {
  container: HTMLDivElement;
  root: Root;
  invalidateSpy: ReturnType<typeof vi.spyOn>;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = testQueryClient();
  const invalidateSpy = vi.spyOn(client, "invalidateQueries");
  act(() => {
    root.render(panelTree(<AgentRunsPanel {...props} />, client));
  });
  return { container, root, invalidateSpy };
}

function deliverTopic(topic: string, message: TopicMessage) {
  const listener = topicState.listeners.get(topic);
  expect(listener).toBeTruthy();
  act(() => {
    listener!(message);
  });
}

function clickHeader(container: ParentNode, delegationId: string) {
  const card = container.querySelector(
    `[data-run-id="${delegationId}"] [data-testid="agent-run-card-header"]`,
  ) as HTMLButtonElement | null;
  expect(card).toBeTruthy();
  act(() => {
    card!.click();
  });
}

const PROJECT_ID = "platform";

afterEach(() => {
  document.body.innerHTML = "";
  queryState.data = { runs: [], workRoot: undefined };
  queryState.isLoading = false;
  queryState.error = null;
  eventsQueryState.data = { events: [] };
  eventsQueryState.isLoading = false;
  eventsQueryState.error = null;
  eventsQueryState.expandedCalls = [];
  topicState.listeners.clear();
});

describe("AgentRunsPanel", () => {
  it("lists runs oldest first with resume marker and distinct status indicators", () => {
    queryState.data = {
      runs: [
        sampleRun({
          delegationId: "del-oldest",
          startedAt: AT,
          status: "running",
          endedAt: undefined,
        }),
        sampleRun({
          delegationId: "del-resume",
          startedAt: AT_MID,
          status: "completed",
          endedAt: AT_END,
          isResume: true,
        }),
        sampleRun({
          delegationId: "del-newest",
          startedAt: AT_END,
          status: "error",
          endedAt: AT_END,
        }),
      ],
    };

    const { container } = mountPanel({ issueId: "task-1", projectId: PROJECT_ID });
    const cards = Array.from(
      container.querySelectorAll("[data-run-id]"),
    ) as HTMLElement[];

    expect(cards.map((card) => card.getAttribute("data-run-id"))).toEqual([
      "del-oldest",
      "del-resume",
      "del-newest",
    ]);

    expect(
      container.querySelector('[data-run-id="del-resume"] [data-resume-marker]'),
    ).toBeTruthy();

    const indicators = cards.map(
      (card) =>
        card.querySelector("[data-status-indicator]")?.getAttribute(
          "data-status-indicator",
        ),
    );
    expect(new Set(indicators)).toEqual(
      new Set(["error", "completed", "running"]),
    );
  });

  it("expands a running run on mount and keeps completed runs collapsed", () => {
    queryState.data = {
      runs: [
        sampleRun({
          delegationId: "del-running",
          status: "running",
          endedAt: undefined,
        }),
        sampleRun({
          delegationId: "del-done",
          status: "completed",
          endedAt: AT_END,
        }),
      ],
    };

    const { container } = mountPanel({ issueId: "task-1", projectId: PROJECT_ID });

    expect(
      container.querySelector('[data-run-id="del-running"][data-expanded]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-run-id="del-running"] [data-slot="agent-run-body"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-run-id="del-done"][data-expanded]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-run-id="del-done"] [data-slot="agent-run-body"]'),
    ).toBeNull();
    expect(eventsQueryState.expandedCalls).toEqual(["del-running"]);
  });

  it("expands a completed run when its header is clicked", () => {
    queryState.data = {
      runs: [
        sampleRun({
          delegationId: "del-done",
          status: "completed",
          endedAt: AT_END,
        }),
      ],
    };

    const { container } = mountPanel({ issueId: "task-1", projectId: PROJECT_ID });
    clickHeader(container, "del-done");

    expect(
      container.querySelector('[data-run-id="del-done"][data-expanded]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-run-id="del-done"] [data-slot="agent-run-body"]'),
    ).toBeTruthy();
    expect(eventsQueryState.expandedCalls).toEqual(["del-done"]);
  });

  it("folds consecutive tool calls into one Tool use group in an expanded run body", () => {
    queryState.data = {
      runs: [
        sampleRun({
          delegationId: "del-done",
          status: "completed",
          endedAt: AT_END,
        }),
      ],
    };
    eventsQueryState.data = {
      events: [
        {
          type: "subagent_update",
          parentCallId: "call-1",
          step: {
            kind: "tool_call",
            callId: "tool-1",
            name: "Read",
            status: "completed",
            args: { path: "a.ts" },
          },
          at: AT,
          seq: 1,
        },
        {
          type: "subagent_update",
          parentCallId: "call-1",
          step: {
            kind: "tool_call",
            callId: "tool-2",
            name: "Read",
            status: "completed",
            args: { path: "b.ts" },
          },
          at: AT,
          seq: 2,
        },
        {
          type: "subagent_update",
          parentCallId: "call-1",
          step: {
            kind: "tool_call",
            callId: "tool-3",
            name: "Grep",
            status: "completed",
            args: { pattern: "foo" },
          },
          at: AT,
          seq: 3,
        },
      ],
    };

    const { container } = mountPanel({ issueId: "task-1", projectId: PROJECT_ID });
    clickHeader(container, "del-done");

    const groups = container.querySelectorAll('[data-event="tool_use_group"]');
    expect(groups).toHaveLength(1);
    const group = groups[0] as HTMLDetailsElement;
    expect(group.getAttribute("data-tool-count")).toBe("3");
    expect(group.getAttribute("data-status")).toBe("completed");
    expect(group.querySelector("summary")!.textContent).toContain("Tool use");
    expect(group.querySelector("[data-call-id='tool-1']")).toBeTruthy();
    expect(group.querySelector("[data-call-id='tool-2']")).toBeTruthy();
    expect(group.querySelector("[data-call-id='tool-3']")).toBeTruthy();
  });

  it("starts a new Tool use group after assistant text between tool calls", () => {
    queryState.data = {
      runs: [
        sampleRun({
          delegationId: "del-done",
          status: "completed",
          endedAt: AT_END,
        }),
      ],
    };
    eventsQueryState.data = {
      events: [
        {
          type: "subagent_update",
          parentCallId: "call-1",
          step: {
            kind: "tool_call",
            callId: "tool-1",
            name: "Read",
            status: "completed",
            args: { path: "a.ts" },
          },
          at: AT,
          seq: 1,
        },
        {
          type: "subagent_update",
          parentCallId: "call-1",
          step: {
            kind: "tool_call",
            callId: "tool-2",
            name: "Read",
            status: "completed",
            args: { path: "b.ts" },
          },
          at: AT,
          seq: 2,
        },
        {
          type: "subagent_update",
          parentCallId: "call-1",
          step: { kind: "text", text: "Both files are in." },
          at: AT,
          seq: 3,
        },
        {
          type: "subagent_update",
          parentCallId: "call-1",
          step: {
            kind: "tool_call",
            callId: "tool-3",
            name: "Shell",
            status: "completed",
            args: { command: "npm test" },
          },
          at: AT,
          seq: 4,
        },
      ],
    };

    const { container } = mountPanel({ issueId: "task-1", projectId: PROJECT_ID });
    clickHeader(container, "del-done");

    const groups = container.querySelectorAll('[data-event="tool_use_group"]');
    expect(groups).toHaveLength(2);
    expect(groups[0]!.getAttribute("data-tool-count")).toBe("2");
    expect(groups[1]!.getAttribute("data-tool-count")).toBe("1");

    const text = container.querySelector('[data-run-step="text"]');
    expect(text).toBeTruthy();
    expect(text!.textContent).toContain("Both files are in.");
    expect(text!.closest('[data-event="tool_use_group"]')).toBeNull();
  });

  it("renders each step kind through its matching transcript primitive", () => {
    queryState.data = {
      runs: [
        sampleRun({
          delegationId: "del-done",
          status: "completed",
          endedAt: AT_END,
        }),
      ],
    };
    eventsQueryState.data = {
      events: [
        {
          type: "subagent_update",
          parentCallId: "call-1",
          step: { kind: "text", text: "Done implementing." },
          at: AT,
          seq: 1,
        },
        {
          type: "subagent_update",
          parentCallId: "call-1",
          step: { kind: "thinking", text: "Need to inspect the panel." },
          at: AT,
          seq: 2,
        },
        {
          type: "subagent_update",
          parentCallId: "call-1",
          step: {
            kind: "tool_call",
            callId: "tool-1",
            name: "Read",
            status: "completed",
            args: { path: "agent-runs-panel.tsx" },
          },
          at: AT,
          seq: 3,
        },
      ],
    };

    const { container } = mountPanel({ issueId: "task-1", projectId: PROJECT_ID });
    clickHeader(container, "del-done");

    expect(container.querySelector('[data-run-step="text"]')).toBeTruthy();
    expect(container.querySelector('[data-run-step="thinking"]')).toBeTruthy();
    expect(container.querySelector('[data-run-step="tool_call"]')).toBeTruthy();
    expect(container.textContent).toContain("Done implementing.");
    expect(container.textContent).toContain("Need to inspect the panel.");
    expect(container.textContent).toContain("Read");
  });

  it("does not mount composer controls on the agents tab", () => {
    queryState.data = {
      runs: [
        sampleRun({
          delegationId: "del-running",
          status: "running",
          endedAt: undefined,
        }),
      ],
    };

    const { container } = mountPanel({ issueId: "task-1", projectId: PROJECT_ID });

    expect(container.querySelector("textarea")).toBeNull();
    expect(container.querySelector('[data-slot="composer"]')).toBeNull();
    expect(container.querySelector('[data-slot="open-thread-chrome"]')).toBeNull();
    expect(container.querySelector('[data-slot="conversation-thread"]')).toBeNull();
    expect(Array.from(container.querySelectorAll("button")).some((btn) =>
      btn.textContent?.includes("Send"),
    )).toBe(false);
  });

  it("shows loading and error states while fetching an expanded body", () => {
    queryState.data = {
      runs: [
        sampleRun({
          delegationId: "del-done",
          status: "completed",
          endedAt: AT_END,
        }),
      ],
    };
    eventsQueryState.isLoading = true;

    const loadingMount = mountPanel({ issueId: "task-1", projectId: PROJECT_ID });
    clickHeader(loadingMount.container, "del-done");
    expect(
      loadingMount.container.querySelector('[data-slot="agent-run-body"][data-state="loading"]'),
    ).toBeTruthy();

    eventsQueryState.isLoading = false;
    eventsQueryState.error = new Error("events unavailable");

    const errorMount = mountPanel({ issueId: "task-1", projectId: PROJECT_ID });
    clickHeader(errorMount.container, "del-done");
    expect(
      errorMount.container.querySelector('[data-slot="agent-run-body"][data-state="error"]'),
    ).toBeTruthy();
    expect(errorMount.container.textContent).toContain("events unavailable");
  });

  it("keeps run headers within a 390px-wide viewport", () => {
    queryState.data = {
      runs: [
        sampleRun({
          role: "issue-tracker-implementor-composer",
          model: "composer-2.5-fast",
          status: "completed",
          endedAt: AT_END,
          isResume: true,
        }),
      ],
    };

    const shell = document.createElement("div");
    shell.style.width = "390px";
    shell.style.overflow = "hidden";
    document.body.appendChild(shell);
    const root = createRoot(shell);
    act(() => {
      root.render(
        panelTree(
          <AgentRunsPanel issueId="task-1" projectId={PROJECT_ID} />,
          testQueryClient(),
        ),
      );
    });

    expect(shell.scrollWidth).toBeLessThanOrEqual(390);
  });

  it("keeps an expanded body within a 390px-wide viewport", () => {
    const longArg = "x".repeat(240);
    queryState.data = {
      runs: [
        sampleRun({
          delegationId: "del-done",
          status: "completed",
          endedAt: AT_END,
        }),
      ],
    };
    eventsQueryState.data = {
      events: [
        {
          type: "subagent_update",
          parentCallId: "call-1",
          step: {
            kind: "text",
            text: "A long wrapped sentence that should stay inside the card without forcing horizontal overflow on a narrow phone viewport.",
          },
          at: AT,
          seq: 1,
        },
        {
          type: "subagent_update",
          parentCallId: "call-1",
          step: {
            kind: "tool_call",
            callId: "tool-long",
            name: "Shell",
            status: "completed",
            args: { command: longArg },
          },
          at: AT,
          seq: 2,
        },
      ],
    };

    const shell = document.createElement("div");
    shell.style.width = "390px";
    shell.style.overflow = "hidden";
    document.body.appendChild(shell);
    const root = createRoot(shell);
    act(() => {
      root.render(
        panelTree(
          <AgentRunsPanel issueId="task-1" projectId={PROJECT_ID} />,
          testQueryClient(),
        ),
      );
    });
    clickHeader(shell, "del-done");

    expect(shell.scrollWidth).toBeLessThanOrEqual(390);
    const card = shell.querySelector('[data-run-id="del-done"]') as HTMLElement;
    expect(card).toBeTruthy();
    expect(card.scrollWidth).toBeLessThanOrEqual(390);
  });

  it("renders an empty state when there are no linked runs", () => {
    const { container } = mountPanel({ issueId: "task-1", projectId: PROJECT_ID });

    expect(
      container.querySelector('[data-testid="agent-runs-empty-state"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain(
      "No agent has run against this issue yet.",
    );
  });

  it("renders no coordinator link when workRoot is absent", () => {
    queryState.data = { runs: [], workRoot: undefined };

    const { container } = mountPanel({ issueId: "task-1", projectId: PROJECT_ID });

    expect(
      container.querySelector('[data-testid="agent-runs-coordinator-link"]'),
    ).toBeNull();
  });

  it("renders a coordinator link when workRoot is present", () => {
    queryState.data = {
      runs: [],
      workRoot: { issueId: "ship-it", conversationId: "conv-coordinator" },
    };

    const { container } = mountPanel({ issueId: "task-1", projectId: PROJECT_ID });
    const link = container.querySelector(
      '[data-testid="agent-runs-coordinator-link"]',
    ) as HTMLAnchorElement | null;

    expect(link).toBeTruthy();
    expect(link?.getAttribute("href")).toBe(
      "/projects/platform/issues/ship-it?tab=implementing",
    );
  });

  it("renders a coordinator link above populated runs", () => {
    queryState.data = {
      runs: [sampleRun()],
      workRoot: { issueId: "ship-it", conversationId: "conv-coordinator" },
    };

    const { container } = mountPanel({ issueId: "task-1", projectId: PROJECT_ID });

    expect(
      container.querySelector('[data-testid="agent-runs-coordinator-link"]'),
    ).toBeTruthy();
    expect(container.querySelector('[data-run-id="del-1"]')).toBeTruthy();
  });

  it("links each run card to that run's diagram", () => {
    queryState.data = {
      runs: [
        sampleRun({
          delegationId: "del-a",
          conversationId: "conv-a",
        }),
        sampleRun({
          delegationId: "del-b",
          parentCallId: "call-2",
          conversationId: "conv/b",
        }),
      ],
    };

    const { container } = mountPanel({ issueId: "task-1", projectId: PROJECT_ID });
    const hrefFor = (delegationId: string) =>
      container
        .querySelector(
          `[data-run-id="${delegationId}"] [data-testid="agent-run-diagram-link"]`,
        )
        ?.getAttribute("href");

    expect(hrefFor("del-a")).toBe("/pipeline/runs/conv-a");
    expect(hrefFor("del-b")).toBe("/pipeline/runs/conv%2Fb");
  });

  it("does not expand a collapsed run when the diagram link is activated", () => {
    queryState.data = {
      runs: [
        sampleRun({
          delegationId: "del-done",
          status: "completed",
          endedAt: AT_END,
        }),
      ],
    };

    const { container } = mountPanel({ issueId: "task-1", projectId: PROJECT_ID });
    const link = container.querySelector(
      '[data-run-id="del-done"] [data-testid="agent-run-diagram-link"]',
    ) as HTMLAnchorElement | null;
    expect(link).toBeTruthy();
    act(() => {
      link!.click();
    });

    expect(
      container.querySelector('[data-run-id="del-done"][data-expanded]'),
    ).toBeNull();
    expect(
      container.querySelector(
        '[data-run-id="del-done"] [data-slot="agent-run-body"]',
      ),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="location-probe"]')?.textContent,
    ).toBe("/pipeline/runs/conv-1");
  });

  it("subscribes to the work root conversation and appends a matching run in startedAt order", () => {
    queryState.data = {
      runs: [
        sampleRun({
          delegationId: "del-old",
          parentCallId: "call-old",
          startedAt: AT,
          status: "completed",
          endedAt: AT,
        }),
        sampleRun({
          delegationId: "del-new",
          parentCallId: "call-new",
          startedAt: AT_END,
          status: "running",
          endedAt: undefined,
        }),
      ],
      workRoot: { issueId: "ship-it", conversationId: "conv-coordinator" },
    };

    const { container } = mountPanel({ issueId: "task-1", projectId: PROJECT_ID });
    expect(topicState.listeners.has("conversation:conv-coordinator")).toBe(true);

    deliverTopic("conversation:conv-coordinator", {
      type: "event",
      seq: 10,
      event: {
        type: "delegation",
        run: sampleRun({
          delegationId: "del-mid",
          parentCallId: "call-mid",
          startedAt: AT_MID,
          status: "running",
          endedAt: undefined,
        }),
        at: AT_MID,
        seq: 10,
      },
    });

    expect(
      Array.from(container.querySelectorAll("[data-run-id]")).map((card) =>
        card.getAttribute("data-run-id"),
      ),
    ).toEqual(["del-old", "del-mid", "del-new"]);
  });

  it("ignores a delegation frame whose run belongs to a different issue", () => {
    queryState.data = {
      runs: [sampleRun()],
      workRoot: { issueId: "ship-it", conversationId: "conv-coordinator" },
    };

    const { container } = mountPanel({ issueId: "task-1", projectId: PROJECT_ID });

    deliverTopic("conversation:conv-coordinator", {
      type: "event",
      seq: 11,
      event: {
        type: "delegation",
        run: sampleRun({
          delegationId: "del-other",
          issueId: "other-task",
          parentCallId: "call-other",
          status: "running",
          endedAt: undefined,
        }),
        at: AT_MID,
        seq: 11,
      },
    });

    expect(container.querySelector('[data-run-id="del-other"]')).toBeNull();
    expect(container.querySelectorAll("[data-run-id]")).toHaveLength(1);
  });

  it("flips status and fills duration when a delegation_end matches parentCallId", () => {
    queryState.data = {
      runs: [
        sampleRun({
          delegationId: "del-live",
          parentCallId: "call-1",
          startedAt: AT,
          status: "running",
          endedAt: undefined,
        }),
      ],
      workRoot: { issueId: "ship-it", conversationId: "conv-coordinator" },
    };

    const { container } = mountPanel({ issueId: "task-1", projectId: PROJECT_ID });
    const card = container.querySelector('[data-run-id="del-live"]') as HTMLElement;
    expect(card.getAttribute("data-status")).toBe("running");
    expect(card.querySelector("[data-duration]")).toBeNull();

    deliverTopic("conversation:conv-coordinator", {
      type: "event",
      seq: 12,
      event: {
        type: "delegation_end",
        delegationId: "del-live",
        parentCallId: "call-1",
        status: "completed",
        endedAt: "2026-07-09T14:00:12.000Z",
        at: "2026-07-09T14:00:12.000Z",
        seq: 12,
      },
    });

    expect(card.getAttribute("data-status")).toBe("completed");
    expect(
      card.querySelector("[data-status-indicator]")?.getAttribute(
        "data-status-indicator",
      ),
    ).toBe("completed");
    expect(card.querySelector("[data-duration]")?.textContent).toBe("12s");
  });

  it("drops the live overlay and invalidates agent runs on topic reset", () => {
    queryState.data = {
      runs: [sampleRun({ delegationId: "del-seed" })],
      workRoot: { issueId: "ship-it", conversationId: "conv-coordinator" },
    };

    const { container, invalidateSpy } = mountPanel({
      issueId: "task-1",
      projectId: PROJECT_ID,
    });

    deliverTopic("conversation:conv-coordinator", {
      type: "event",
      seq: 10,
      event: {
        type: "delegation",
        run: sampleRun({
          delegationId: "del-live",
          parentCallId: "call-live",
          startedAt: AT_MID,
          status: "running",
          endedAt: undefined,
        }),
        at: AT_MID,
        seq: 10,
      },
    });
    expect(container.querySelector('[data-run-id="del-live"]')).toBeTruthy();

    deliverTopic("conversation:conv-coordinator", { type: "reset" });

    expect(container.querySelector('[data-run-id="del-live"]')).toBeNull();
    expect(container.querySelector('[data-run-id="del-seed"]')).toBeTruthy();
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: issuesKeys.agentRuns("task-1"),
    });
  });

  it("appends live subagent_update frames to an expanded run in seq order", () => {
    queryState.data = {
      runs: [
        sampleRun({
          delegationId: "del-live",
          status: "running",
          endedAt: undefined,
        }),
      ],
      workRoot: { issueId: "ship-it", conversationId: "conv-coordinator" },
    };
    eventsQueryState.data = {
      events: [
        {
          type: "subagent_update",
          parentCallId: "call-1",
          step: { kind: "text", text: "Seeded opener." },
          at: AT,
          seq: 1,
        },
      ],
    };

    const { container } = mountPanel({ issueId: "task-1", projectId: PROJECT_ID });
    expect(
      container.querySelector('[data-run-id="del-live"][data-expanded]'),
    ).toBeTruthy();

    deliverTopic("conversation:conv-coordinator", {
      type: "event",
      seq: 3,
      event: {
        type: "subagent_update",
        parentCallId: "call-1",
        step: {
          kind: "tool_call",
          callId: "tool-live",
          name: "Read",
          status: "running",
          args: { path: "panel.tsx" },
        },
        at: AT,
        seq: 3,
      },
    });
    deliverTopic("conversation:conv-coordinator", {
      type: "event",
      seq: 2,
      event: {
        type: "subagent_update",
        parentCallId: "call-1",
        step: { kind: "thinking", text: "Checking the card body." },
        at: AT,
        seq: 2,
      },
    });

    const steps = Array.from(
      container.querySelectorAll("[data-run-step]"),
    ).map((node) => node.getAttribute("data-run-step"));
    expect(steps).toEqual(["text", "thinking", "tool_call"]);
    expect(container.textContent).toContain("Seeded opener.");
    expect(container.textContent).toContain("Checking the card body.");
    expect(container.textContent).toContain("Read");
  });

  it("renders nothing for live frames that belong to a collapsed run", () => {
    queryState.data = {
      runs: [
        sampleRun({
          delegationId: "del-done",
          status: "completed",
          endedAt: AT_END,
        }),
      ],
      workRoot: { issueId: "ship-it", conversationId: "conv-coordinator" },
    };

    const { container } = mountPanel({ issueId: "task-1", projectId: PROJECT_ID });
    expect(
      container.querySelector('[data-run-id="del-done"][data-expanded]'),
    ).toBeNull();

    deliverTopic("conversation:conv-coordinator", {
      type: "event",
      seq: 4,
      event: {
        type: "subagent_update",
        parentCallId: "call-1",
        step: { kind: "text", text: "Should stay hidden." },
        at: AT,
        seq: 4,
      },
    });

    expect(
      container.querySelector('[data-run-id="del-done"] [data-slot="agent-run-body"]'),
    ).toBeNull();
    expect(container.querySelector("[data-run-step]")).toBeNull();
    expect(container.textContent).not.toContain("Should stay hidden.");
  });

  it("opens a run expanded when it starts while the panel is open", () => {
    queryState.data = {
      runs: [],
      workRoot: { issueId: "ship-it", conversationId: "conv-coordinator" },
    };

    const { container } = mountPanel({ issueId: "task-1", projectId: PROJECT_ID });
    expect(
      container.querySelector('[data-testid="agent-runs-empty-state"]'),
    ).toBeTruthy();

    deliverTopic("conversation:conv-coordinator", {
      type: "event",
      seq: 10,
      event: {
        type: "delegation",
        run: sampleRun({
          delegationId: "del-fresh",
          parentCallId: "call-fresh",
          status: "running",
          endedAt: undefined,
        }),
        at: AT,
        seq: 10,
      },
    });

    const card = container.querySelector(
      '[data-run-id="del-fresh"]',
    ) as HTMLElement | null;
    expect(card).toBeTruthy();
    expect(card?.hasAttribute("data-expanded")).toBe(true);
    expect(card?.querySelector('[data-slot="agent-run-body"]')).toBeTruthy();
    expect(eventsQueryState.expandedCalls).toContain("del-fresh");
  });
});

describe("AgentRunCard", () => {
  it("shows duration once the run has ended", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <MemoryRouter>
          <AgentRunCard
            issueId="task-1"
            run={sampleRun({
              startedAt: AT,
              endedAt: "2026-07-09T14:00:12.000Z",
            })}
          />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector("[data-duration]")?.textContent).toBe("12s");
    expect(
      container
        .querySelector('[data-testid="agent-run-diagram-link"]')
        ?.getAttribute("href"),
    ).toBe("/pipeline/runs/conv-1");
  });
});
