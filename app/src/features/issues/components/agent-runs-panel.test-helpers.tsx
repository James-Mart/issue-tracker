import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, expect, vi } from "vitest";
import type { AgentRun, TranscriptEvent } from "@server/schemas";
import type { TopicListener, TopicMessage } from "@/lib/ws/transport";
import { AgentRunsPanel } from "./agent-runs-panel";

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, TopicListener>();
  const topicState = {
    listeners,
    subscribe: (topic: string, listener: TopicListener) => {
      listeners.set(topic, listener);
      return () => {
        listeners.delete(topic);
      };
    },
  };
  const queryState = {
    data: {
      runs: [] as AgentRun[],
      workRoot: undefined as
        | { issueId: string; conversationId: string }
        | undefined,
    },
    isLoading: false,
    error: null as Error | null,
  };
  const eventsQueryState = {
    data: { events: [] as TranscriptEvent[] },
    isLoading: false,
    error: null as Error | null,
    expandedCalls: [] as string[],
  };
  return { queryState, eventsQueryState, topicState };
});

export const queryState = mocks.queryState;
export const eventsQueryState = mocks.eventsQueryState;
export const topicState = mocks.topicState;

vi.mock("@/lib/ws/transport", () => ({
  subscribeTopic: (topic: string, listener: TopicListener) =>
    topicState.subscribe(topic, listener),
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

export const AT = "2026-07-09T14:00:00.000Z";
export const AT_MID = "2026-07-09T15:00:00.000Z";
export const AT_END = "2026-07-09T16:00:00.000Z";
export const PROJECT_ID = "platform";

export function sampleRun(overrides: Partial<AgentRun> = {}): AgentRun {
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

export function testQueryClient(): QueryClient {
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

export function panelTree(panel: ReactNode, client: QueryClient) {
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

export function mountPanel(props: ComponentProps<typeof AgentRunsPanel>): {
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

export function deliverTopic(topic: string, message: TopicMessage) {
  const listener = topicState.listeners.get(topic);
  expect(listener).toBeTruthy();
  act(() => {
    listener!(message);
  });
}

export function clickHeader(container: ParentNode, delegationId: string) {
  const card = container.querySelector(
    `[data-run-id="${delegationId}"] [data-testid="agent-run-card-header"]`,
  ) as HTMLButtonElement | null;
  expect(card).toBeTruthy();
  act(() => {
    card!.click();
  });
}

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
