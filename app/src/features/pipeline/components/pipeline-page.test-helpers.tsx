import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  notifyManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, vi } from "vitest";
import type { AgentRun } from "@server/schemas";
import type { TopicListener, TopicMessage } from "@/lib/ws/transport";
import { type RecentRun } from "../run-list";
import type { RunSequence } from "../run-sequence";
import { PipelinePage } from "./pipeline-page";
import {
  LegacyPipelineRedirect,
  LegacyPipelineRunRedirect,
  LegacyPipelineRunsRedirect,
} from "../pipeline-legacy-redirects";

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

export const LIVE_AT_NESTED = "2026-08-28T12:00:12.000Z";
export const LIVE_AT_APPEND = "2026-08-28T13:00:00.000Z";

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <div data-testid="location-probe">{pathname + search}</div>;
}

function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

export function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

export function mountPipelinePage(entry: string): {
  container: HTMLDivElement;
  root: Root;
  client: QueryClient;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = testQueryClient();
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/pipelines" element={<PipelinePage />} />
            <Route path="/runs" element={<PipelinePage />} />
            <Route
              path="/runs/:conversationId"
              element={<PipelinePage />}
            />
            <Route
              path="/pipeline/runs/:conversationId"
              element={<LegacyPipelineRunRedirect />}
            />
            <Route
              path="/pipeline/runs"
              element={<LegacyPipelineRunsRedirect />}
            />
            <Route path="/pipeline" element={<LegacyPipelineRedirect />} />
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  return { container, root, client };
}

export async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

export function sourcePanel(container: ParentNode): HTMLElement {
  const el = container.querySelector('[data-testid="pipeline-step-source-panel"]');
  if (!(el instanceof HTMLElement)) {
    throw new Error("Missing step source panel");
  }
  return el;
}

export function tab(container: ParentNode, label: string): HTMLElement {
  const match = Array.from(container.querySelectorAll('[role="tab"]')).find(
    (el) => el.textContent?.trim() === label,
  );
  if (!(match instanceof HTMLElement)) {
    throw new Error(`Missing tab: ${label}`);
  }
  return match;
}

export function pipelineTabs(container: ParentNode): HTMLElement[] {
  const list = container.querySelector('[role="tablist"][aria-label="Pipeline"]');
  if (!(list instanceof HTMLElement)) {
    throw new Error("Missing pipeline switch");
  }
  return Array.from(list.querySelectorAll('[role="tab"]'));
}

export function pageEyebrow(container: ParentNode): string | null {
  const header = container.querySelector("header p");
  return header?.textContent?.trim() ?? null;
}

export function diagram(container: ParentNode): HTMLElement {
  const el = container.querySelector('[data-testid="pipeline-diagram"]');
  if (!(el instanceof HTMLElement)) {
    throw new Error("Missing pipeline diagram");
  }
  return el;
}

export function nodeEl(container: ParentNode, id: string): HTMLElement {
  const el = container.querySelector(
    `[data-testid="pipeline-node"][data-id="${id}"]`,
  );
  if (!(el instanceof HTMLElement)) {
    throw new Error(`Missing node: ${id}`);
  }
  return el;
}

export function recentRun(
  conversationId: string,
  condition: RecentRun["condition"],
  startedAt: string,
): RecentRun {
  return {
    conversationId,
    coordinatorLabel: conversationId,
    startedAt,
    condition,
  };
}

export const FIVE_RUNS: RecentRun[] = [
  recentRun("a", "completed", "2026-08-28T15:00:00.000Z"),
  recentRun("b", "completed", "2026-08-28T14:00:00.000Z"),
  recentRun("c", "completed", "2026-08-28T13:00:00.000Z"),
  recentRun("d", "failed", "2026-08-28T12:00:00.000Z"),
  recentRun("e", "completed", "2026-08-28T11:00:00.000Z"),
];

function emptySequence(conversationId: string): RunSequence {
  return {
    condition: "completed",
    lifelines: [
      { id: "coordinator", label: conversationId, kind: "coordinator" },
    ],
    beats: [],
    sections: [],
  };
}

export function stubRuns(
  runs: RecentRun[] = [],
  sequences: Record<string, RunSequence> = {},
) {
  const fetchMock = vi.fn().mockImplementation((input: RequestInfo) => {
    const url = String(input);
    const runMatch = /^\/api\/pipeline\/runs\/([^?]+)$/.exec(url);
    if (runMatch) {
      const id = decodeURIComponent(runMatch[1]!);
      return Promise.resolve(
        jsonResponse(sequences[id] ?? emptySequence(id)),
      );
    }
    if (url.startsWith("/api/pipeline/runs")) {
      return Promise.resolve(jsonResponse({ runs, nextCursor: null }));
    }
    return Promise.resolve(jsonResponse({ error: `unhandled ${url}` }, 404));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export function runCards(container: ParentNode): HTMLElement[] {
  return Array.from(
    container.querySelectorAll('[data-testid="pipeline-run-card"]'),
  ) as HTMLElement[];
}

export function runCard(container: ParentNode, conversationId: string): HTMLElement {
  const el = container.querySelector(
    `[data-testid="pipeline-run-card"][data-conversation-id="${conversationId}"]`,
  );
  if (!(el instanceof HTMLElement)) {
    throw new Error(`Missing run card: ${conversationId}`);
  }
  return el;
}

export function sequencePaneHeader(container: ParentNode): HTMLElement {
  const el = container.querySelector('[data-testid="run-sequence-pane-header"]');
  if (!(el instanceof HTMLElement)) {
    throw new Error("Missing sequence pane header");
  }
  return el;
}

export function sequenceSheet(): HTMLElement {
  const el = document.querySelector(
    '[data-testid="pipeline-run-sequence-sheet"]',
  );
  if (!(el instanceof HTMLElement)) {
    throw new Error("Missing run sequence sheet");
  }
  return el;
}

export function sheetCloseControl(sheet: ParentNode): HTMLElement {
  const close = Array.from(sheet.querySelectorAll("button")).find((el) =>
    el.textContent?.includes("Close"),
  );
  if (!(close instanceof HTMLElement)) {
    throw new Error("Missing sheet close control");
  }
  return close;
}

export function mockViewport(width: number, height = 700) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
  });
  window.matchMedia = vi.fn((query: string) => {
    const max = /\(max-width:\s*(\d+)px\)/.exec(query);
    const matches = max ? width <= Number(max[1]) : false;
    return {
      media: query,
      matches,
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as MediaQueryList;
  });
}

export function tallRunSequence(beatCount: number): RunSequence {
  const beats = Array.from({ length: beatCount }, (_, index) => ({
    from: index % 2 === 0 ? "coordinator" : "research",
    to: index % 2 === 0 ? "research" : "coordinator",
    label: `beat ${index + 1}`,
    startedAt: new Date(Date.UTC(2026, 7, 28, 12, index)).toISOString(),
    durationMs: 30_000,
    kind: (index % 2 === 0 ? "spawn" : "return") as const,
  }));
  return {
    condition: "completed",
    lifelines: [
      { id: "coordinator", label: "planning", kind: "coordinator" },
      { id: "research", label: "research", kind: "role" },
    ],
    sections: [],
    beats,
  };
}

export function inFlightTallRunSequence(beatCount: number): RunSequence {
  const closed = Array.from({ length: beatCount - 1 }, (_, index) => ({
    from: index % 2 === 0 ? "coordinator" : "research",
    to: index % 2 === 0 ? "research" : "coordinator",
    label: `beat ${index + 1}`,
    startedAt: new Date(Date.UTC(2026, 7, 28, 12, index)).toISOString(),
    durationMs: 30_000,
    kind: (index % 2 === 0 ? "spawn" : "return") as const,
  }));
  return {
    condition: "in-flight",
    lifelines: [
      { id: "coordinator", label: "planning", kind: "coordinator" },
      { id: "research", label: "research", kind: "role" },
    ],
    sections: [],
    beats: [
      ...closed,
      {
        from: "coordinator",
        to: "research",
        label: "spawn research",
        startedAt: new Date(Date.UTC(2026, 7, 28, 12, beatCount - 1)).toISOString(),
        kind: "spawn" as const,
        parentCallId: "call-open",
      },
    ],
  };
}

export function liveSampleRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    delegationId: "del-live",
    agentId: "agent-live",
    role: "validator",
    model: "composer-2.5",
    issueId: "run-live-updates",
    parentCallId: "call-live",
    conversationId: "e",
    startedAt: LIVE_AT_APPEND,
    status: "running",
    isResume: false,
    ...overrides,
  };
}

export function hasTopicListener(topic: string): boolean {
  return topicState.listeners.has(topic);
}

export function deliverTopic(topic: string, message: TopicMessage) {
  const listener = topicState.listeners.get(topic);
  expect(listener).toBeTruthy();
  act(() => {
    listener!(message);
  });
}

export function sequenceScrollBody(sheet: ParentNode): HTMLElement {
  const el = sheet.querySelector('[data-testid="run-sequence-scroll-body"]');
  if (!(el instanceof HTMLElement)) {
    throw new Error("Missing run sequence scroll body");
  }
  return el;
}

export function mockScrollOverflow(
  scroller: HTMLElement,
  scrollHeight: number,
  clientHeight: number,
) {
  Object.defineProperty(scroller, "scrollHeight", {
    configurable: true,
    value: scrollHeight,
  });
  Object.defineProperty(scroller, "clientHeight", {
    configurable: true,
    value: clientHeight,
  });
  scroller.scrollTop = 0;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  notifyManager.setScheduler((cb) => {
    cb();
  });
  mockViewport(1280);
});

afterEach(() => {
  document.body.innerHTML = "";
  topicState.listeners.clear();
  notifyManager.setScheduler((cb) => {
    setTimeout(cb, 0);
  });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
