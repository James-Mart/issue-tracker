// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  notifyManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRun } from "@server/schemas";
import type { TopicListener, TopicMessage } from "@/lib/ws/transport";
import { PIPELINE_RUNS_LIMIT, type RecentRun } from "../run-list";
import type { RunSequence, RunSequenceSection } from "../run-sequence";
import { pipelines } from "../shape";
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

const LIVE_AT_NESTED = "2026-08-28T12:00:12.000Z";
const LIVE_AT_APPEND = "2026-08-28T13:00:00.000Z";

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

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

function mountPipelinePage(entry: string): {
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

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function sourcePanel(container: ParentNode): HTMLElement {
  const el = container.querySelector('[data-testid="pipeline-step-source-panel"]');
  if (!(el instanceof HTMLElement)) {
    throw new Error("Missing step source panel");
  }
  return el;
}

function tab(container: ParentNode, label: string): HTMLElement {
  const match = Array.from(container.querySelectorAll('[role="tab"]')).find(
    (el) => el.textContent?.trim() === label,
  );
  if (!(match instanceof HTMLElement)) {
    throw new Error(`Missing tab: ${label}`);
  }
  return match;
}

function pipelineTabs(container: ParentNode): HTMLElement[] {
  const list = container.querySelector('[role="tablist"][aria-label="Pipeline"]');
  if (!(list instanceof HTMLElement)) {
    throw new Error("Missing pipeline switch");
  }
  return Array.from(list.querySelectorAll('[role="tab"]'));
}

function pageEyebrow(container: ParentNode): string | null {
  const header = container.querySelector("header p");
  return header?.textContent?.trim() ?? null;
}

function diagram(container: ParentNode): HTMLElement {
  const el = container.querySelector('[data-testid="pipeline-diagram"]');
  if (!(el instanceof HTMLElement)) {
    throw new Error("Missing pipeline diagram");
  }
  return el;
}

function nodeEl(container: ParentNode, id: string): HTMLElement {
  const el = container.querySelector(
    `[data-testid="pipeline-node"][data-id="${id}"]`,
  );
  if (!(el instanceof HTMLElement)) {
    throw new Error(`Missing node: ${id}`);
  }
  return el;
}

function recentRun(
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

const FIVE_RUNS: RecentRun[] = [
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

function stubRuns(
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

function runCards(container: ParentNode): HTMLElement[] {
  return Array.from(
    container.querySelectorAll('[data-testid="pipeline-run-card"]'),
  ) as HTMLElement[];
}

function runCard(container: ParentNode, conversationId: string): HTMLElement {
  const el = container.querySelector(
    `[data-testid="pipeline-run-card"][data-conversation-id="${conversationId}"]`,
  );
  if (!(el instanceof HTMLElement)) {
    throw new Error(`Missing run card: ${conversationId}`);
  }
  return el;
}

function sequencePaneHeader(container: ParentNode): HTMLElement {
  const el = container.querySelector('[data-testid="run-sequence-pane-header"]');
  if (!(el instanceof HTMLElement)) {
    throw new Error("Missing sequence pane header");
  }
  return el;
}

function sequenceSheet(): HTMLElement {
  const el = document.querySelector(
    '[data-testid="pipeline-run-sequence-sheet"]',
  );
  if (!(el instanceof HTMLElement)) {
    throw new Error("Missing run sequence sheet");
  }
  return el;
}

function sheetCloseControl(sheet: ParentNode): HTMLElement {
  const close = Array.from(sheet.querySelectorAll("button")).find((el) =>
    el.textContent?.includes("Close"),
  );
  if (!(close instanceof HTMLElement)) {
    throw new Error("Missing sheet close control");
  }
  return close;
}

function mockViewport(width: number, height = 700) {
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

function tallRunSequence(beatCount: number): RunSequence {
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

function inFlightTallRunSequence(beatCount: number): RunSequence {
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

function liveSampleRun(overrides: Partial<AgentRun> = {}): AgentRun {
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

function deliverTopic(topic: string, message: TopicMessage) {
  const listener = topicState.listeners.get(topic);
  expect(listener).toBeTruthy();
  act(() => {
    listener!(message);
  });
}

function sequenceScrollBody(sheet: ParentNode): HTMLElement {
  const el = sheet.querySelector('[data-testid="run-sequence-scroll-body"]');
  if (!(el instanceof HTMLElement)) {
    throw new Error("Missing run sequence scroll body");
  }
  return el;
}

function mockScrollOverflow(
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

describe("PipelinePage", () => {
  it("renders the planning pipeline diagram on /pipelines with a Pipelines eyebrow", () => {
    const { container } = mountPipelinePage("/pipelines");
    expect(pageEyebrow(container)).toBe("Pipelines");
    expect(diagram(container).getAttribute("data-pipeline")).toBe("planning");
    expect(container.textContent).toContain("Planning");
    expect(
      container.querySelector('[role="tablist"][aria-label="Pipeline view"]'),
    ).toBeNull();
  });

  it("offers every declared pipeline and defaults to planning", () => {
    const { container } = mountPipelinePage("/pipelines");
    const tabs = pipelineTabs(container);
    expect(tabs.map((el) => el.textContent?.trim())).toEqual(
      pipelines.map((pipeline) => pipeline.title),
    );
    expect(tab(container, "Planning").getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(diagram(container).getAttribute("data-pipeline")).toBe("planning");
  });

  it("draws the selected pipeline when the switch is activated", () => {
    const { container } = mountPipelinePage("/pipelines");
    act(() => {
      tab(container, "Work the stack").click();
    });
    expect(diagram(container).getAttribute("data-pipeline")).toBe("work");
    expect(tab(container, "Work the stack").getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(
      container.querySelector('[data-testid="location-probe"]')?.textContent,
    ).toBe("/pipelines?pipeline=work");
    expect(container.textContent).toContain("Implementor");
    expect(container.textContent).not.toContain("Grill-me protocol");
  });

  it("draws the pipeline named in the query string", () => {
    const { container } = mountPipelinePage("/pipelines?pipeline=work");
    expect(diagram(container).getAttribute("data-pipeline")).toBe("work");
    expect(tab(container, "Work the stack").getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("switches the canvas when a handoff node is activated", () => {
    const { container } = mountPipelinePage("/pipelines");
    act(() => {
      nodeEl(container, "work-handoff").click();
    });
    expect(diagram(container).getAttribute("data-pipeline")).toBe("work");
    expect(nodeEl(container, "planning-handoff").getAttribute("data-target-pipeline")).toBe(
      "planning",
    );
    expect(
      container.querySelector('[data-testid="location-probe"]')?.textContent,
    ).toBe("/pipelines?pipeline=work");

    act(() => {
      nodeEl(container, "planning-handoff").click();
    });
    expect(diagram(container).getAttribute("data-pipeline")).toBe("planning");
    expect(
      container.querySelector('[data-testid="location-probe"]')?.textContent,
    ).toBe("/pipelines");
  });

  it("renders a Runs eyebrow on /runs", async () => {
    stubRuns();
    const { container } = mountPipelinePage("/runs");
    await flush();
    expect(pageEyebrow(container)).toBe("Runs");
    expect(container.textContent).toContain("Recent runs");
    expect(
      container.querySelector('[role="tablist"][aria-label="Pipeline view"]'),
    ).toBeNull();
  });

  it("redirects /pipeline/runs/:conversationId to /runs/:conversationId", async () => {
    stubRuns(FIVE_RUNS);
    const { container } = mountPipelinePage("/pipeline/runs/c");
    await flush();
    expect(
      container.querySelector('[data-testid="location-probe"]')?.textContent,
    ).toBe("/runs/c");
    expect(pageEyebrow(container)).toBe("Runs");
  });

  it("renders every fetched run newest-first at desktop width", async () => {
    const fetchMock = stubRuns(FIVE_RUNS);
    const { container } = mountPipelinePage("/runs");
    await flush();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/pipeline/runs?limit=${PIPELINE_RUNS_LIMIT}`,
      expect.anything(),
    );
    expect(
      runCards(container).map((el) => el.getAttribute("data-conversation-id")),
    ).toEqual(["a", "b", "c", "d", "e"]);
    expect(
      container.querySelector('[data-testid="pipeline-run-elision"]'),
    ).toBeNull();
  });

  it("routes selection to /runs/:conversationId", async () => {
    stubRuns(FIVE_RUNS);
    const { container } = mountPipelinePage("/runs");
    await flush();
    act(() => {
      runCard(container, "c").click();
    });
    await flush();
    expect(
      container.querySelector('[data-testid="location-probe"]')?.textContent,
    ).toBe("/runs/c");
    expect(runCard(container, "c").getAttribute("data-current")).toBe("true");
    expect(runCard(container, "c").getAttribute("aria-current")).toBe("true");
  });

  it("marks the run named in the route as selected", async () => {
    stubRuns(FIVE_RUNS);
    const { container } = mountPipelinePage("/runs/d");
    await flush();
    expect(runCard(container, "d").getAttribute("data-current")).toBe("true");
    expect(runCard(container, "a").getAttribute("data-current")).toBeNull();
  });

  it("draws the selected run's sequence at desktop width", async () => {
    const fetchMock = stubRuns(FIVE_RUNS, {
      c: {
        condition: "completed",
        lifelines: [
          { id: "human", label: "human", kind: "human" },
          { id: "coordinator", label: "planning", kind: "coordinator" },
        ],
        sections: [],
        beats: [
          {
            from: "human",
            to: "coordinator",
            label: "human replied",
            startedAt: "2026-08-28T13:00:00.000Z",
            kind: "human-turn",
          },
        ],
        tokenTotal: 184_420,
      },
    });
    const { container } = mountPipelinePage("/runs/c");
    await flush();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/pipeline/runs/c",
      expect.anything(),
    );
    const diagram = container.querySelector(
      '[data-testid="run-sequence-diagram"]',
    );
    expect(diagram?.getAttribute("data-layout")).toBe("desktop");
    expect(diagram?.getAttribute("data-condition")).toBe("completed");
    expect(container.textContent).toContain("human replied");
    const desktopHeader = sequencePaneHeader(container);
    expect(desktopHeader.getAttribute("data-layout")).toBe("desktop");
    expect(desktopHeader.querySelector("h2")?.textContent).toBe("Sequence");
    expect(
      container.querySelector('[data-testid="run-sequence-token-total"]')
        ?.textContent,
    ).toBe("184k tokens");
    expect(
      container.querySelector('[data-testid="pipeline-run-sequence-placeholder"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-testid="pipeline-run-sequence-sheet"]'),
    ).toBeNull();
  });

  it("scrolls a tall phone rail inside the sequence body while the header and handle stay pinned", async () => {
    mockViewport(390, 640);
    stubRuns(FIVE_RUNS, { e: tallRunSequence(24) });
    mountPipelinePage("/runs/e");
    await flush();

    const sheet = sequenceSheet();
    const scrollBody = sequenceScrollBody(sheet);
    const header = sheet.querySelector('[data-testid="run-sequence-pane-header"]');
    const close = sheetCloseControl(sheet);

    expect(scrollBody.className).toMatch(/overflow-y-auto/);
    expect(header).not.toBeNull();
    expect(scrollBody.contains(header)).toBe(false);
    expect(scrollBody.contains(close)).toBe(false);
    expect(close.className).toMatch(/\bmt-auto\b/);

    const beats = Array.from(
      scrollBody.querySelectorAll('[data-testid="sequence-beat"]'),
    ) as HTMLElement[];
    expect(beats.length).toBe(24);

    mockScrollOverflow(scrollBody, 2400, 200);
    expect(scrollBody.scrollHeight).toBeGreaterThan(scrollBody.clientHeight);

    const lastBeat = beats[beats.length - 1]!;
    const bodyBottom = 400;
    lastBeat.getBoundingClientRect = () =>
      ({
        top: bodyBottom + 40,
        bottom: bodyBottom + 80,
        left: 0,
        right: 0,
        width: 0,
        height: 40,
        x: 0,
        y: bodyBottom + 40,
        toJSON: () => ({}),
      }) as DOMRect;
    scrollBody.getBoundingClientRect = () =>
      ({
        top: 200,
        bottom: bodyBottom,
        left: 0,
        right: 0,
        width: 0,
        height: 200,
        x: 0,
        y: 200,
        toJSON: () => ({}),
      }) as DOMRect;

    expect(lastBeat.getBoundingClientRect().bottom).toBeGreaterThan(
      scrollBody.getBoundingClientRect().bottom,
    );

    act(() => {
      scrollBody.scrollTop = scrollBody.scrollHeight;
    });

    lastBeat.getBoundingClientRect = () =>
      ({
        top: bodyBottom - 60,
        bottom: bodyBottom - 20,
        left: 0,
        right: 0,
        width: 0,
        height: 40,
        x: 0,
        y: bodyBottom - 60,
        toJSON: () => ({}),
      }) as DOMRect;

    expect(lastBeat.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      scrollBody.getBoundingClientRect().bottom + 1,
    );
    expect(lastBeat.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      scrollBody.getBoundingClientRect().top - 1,
    );
  });

  it("preserves mid-trace scroll when a live beat appends on an in-flight phone run", async () => {
    mockViewport(390, 640);
    stubRuns(FIVE_RUNS, { e: inFlightTallRunSequence(24) });
    mountPipelinePage("/runs/e");
    await flush();

    expect(topicState.listeners.has("conversation:e")).toBe(true);

    const sheet = sequenceSheet();
    const scrollBody = sequenceScrollBody(sheet);
    mockScrollOverflow(scrollBody, 2400, 200);

    const midScrollTop = 400;
    act(() => {
      scrollBody.scrollTop = midScrollTop;
    });
    expect(scrollBody.scrollTop).toBe(midScrollTop);

    const bodyBottom = 400;
    scrollBody.getBoundingClientRect = () =>
      ({
        top: 200,
        bottom: bodyBottom,
        left: 0,
        right: 0,
        width: 0,
        height: 200,
        x: 0,
        y: 200,
        toJSON: () => ({}),
      }) as DOMRect;

    deliverTopic("conversation:e", {
      type: "event",
      seq: 10,
      event: {
        type: "delegation",
        run: liveSampleRun(),
        at: LIVE_AT_APPEND,
        seq: 10,
      },
    });
    await flush();

    expect(scrollBody.scrollTop).toBe(midScrollTop);

    const beats = Array.from(
      scrollBody.querySelectorAll('[data-testid="sequence-beat"]'),
    ) as HTMLElement[];
    expect(beats.length).toBe(25);
    const appended = beats.find(
      (beat) =>
        beat.querySelector('[data-testid="sequence-beat-label"]')?.textContent ===
        "spawn validator",
    );
    if (!appended) {
      throw new Error("missing appended live beat");
    }

    appended.getBoundingClientRect = () =>
      ({
        top: bodyBottom + 40,
        bottom: bodyBottom + 80,
        left: 0,
        right: 0,
        width: 0,
        height: 40,
        x: 0,
        y: bodyBottom + 40,
        toJSON: () => ({}),
      }) as DOMRect;

    expect(appended.getBoundingClientRect().bottom).toBeGreaterThan(
      scrollBody.getBoundingClientRect().bottom,
    );
    expect(appended.getBoundingClientRect().top).toBeGreaterThan(
      scrollBody.getBoundingClientRect().bottom,
    );
  });

  it("draws the selected run on the Rail at phone width", async () => {
    mockViewport(390);
    stubRuns(FIVE_RUNS, {
      e: {
        condition: "completed",
        lifelines: [
          { id: "human", label: "human", kind: "human" },
          { id: "coordinator", label: "planning", kind: "coordinator" },
        ],
        sections: [],
        beats: [
          {
            from: "human",
            to: "coordinator",
            label: "human replied",
            startedAt: "2026-08-28T13:00:00.000Z",
            kind: "human-turn",
          },
        ],
      },
    });
    const { container } = mountPipelinePage("/runs/e");
    await flush();
    const sheet = sequenceSheet();
    expect(sheet.className).toMatch(/\btop-0\b/);
    expect(sheet.className).toMatch(/\bslide-in-from-top\b/);
    const header = sheet.querySelector('[data-testid="run-sequence-pane-header"]');
    expect(header).toBeTruthy();
    const diagram = sheet.querySelector('[data-testid="run-sequence-diagram"]');
    expect(diagram?.getAttribute("data-layout")).toBe("phone");
    expect(sheet.textContent).toContain("human replied");
    expect(sheet.querySelector('[data-testid="sequence-from"]')?.textContent).toBe(
      "human",
    );
    expect(sheet.querySelector('[data-testid="sequence-to"]')?.textContent).toBe(
      "planning",
    );
    expect(sheetCloseControl(sheet).className).toMatch(/\bmt-auto\b/);
    expect(
      container.querySelector('[data-testid="pipeline-run-list"]')
        ?.querySelector('[data-testid="run-sequence-diagram"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="pipeline-run-sequence-placeholder"]'),
    ).toBeNull();
  });

  it("stacks the phone sheet header so Sequence does not collide with issue and tokens", async () => {
    mockViewport(390);
    stubRuns(FIVE_RUNS, {
      e: {
        condition: "completed",
        lifelines: [
          { id: "coordinator", label: "Stakeholder", kind: "coordinator" },
        ],
        sections: [],
        beats: [],
        tokenTotal: 1_918_558,
        rootIssue: {
          id: "scrollable-runs",
          kind: "idea",
          title: "Scrollable runs",
          projectId: "issue-tracker",
        },
      },
    });
    mountPipelinePage("/runs/e");
    await flush();
    const header = sequenceSheet().querySelector(
      '[data-testid="run-sequence-pane-header"]',
    );
    expect(header?.getAttribute("data-layout")).toBe("phone");
    expect(header?.className).toMatch(/flex-col/);
    expect(header?.querySelector("h2")).toBeNull();
    expect(
      header?.querySelector('[data-testid="run-sequence-root-issue-link"]')
        ?.textContent,
    ).toBe("Scrollable runs");
    expect(
      header?.querySelector('[data-testid="run-sequence-token-total"]')
        ?.textContent,
    ).toBe("1.9M tokens");
    expect(
      header?.querySelector('[data-testid="run-sequence-header-meta"]'),
    ).not.toBeNull();
  });

  it("dismisses the phone sequence sheet back to /runs", async () => {
    mockViewport(390);
    stubRuns(FIVE_RUNS);
    const { container } = mountPipelinePage("/runs/e");
    await flush();
    const sheet = sequenceSheet();
    act(() => {
      sheetCloseControl(sheet).click();
    });
    await flush();
    expect(
      document.querySelector('[data-testid="pipeline-run-sequence-sheet"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="location-probe"]')?.textContent,
    ).toBe("/runs");
    expect(runCard(container, "e").getAttribute("data-current")).toBeNull();
  });

  it("names each model variant on the phone rail caption", async () => {
    mockViewport(390);
    stubRuns(FIVE_RUNS, {
      e: {
        condition: "completed",
        lifelines: [
          { id: "coordinator", label: "Coordinator", kind: "coordinator" },
          {
            id: "implementor",
            label: "Implementor",
            kind: "role",
          },
        ],
        sections: [],
        beats: [
          {
            from: "coordinator",
            to: "implementor",
            label: "spawn Implementor (composer)",
            startedAt: "2026-08-28T13:00:00.000Z",
            durationMs: 30_000,
            kind: "spawn",
            turns: [
              {
                label: "spawn Implementor (composer)",
                startedAt: "2026-08-28T13:00:00.000Z",
                durationMs: 12_000,
              },
              {
                label: "spawn Implementor (sonnet)",
                startedAt: "2026-08-28T13:00:00.000Z",
                durationMs: 18_000,
              },
            ],
          },
        ],
      },
    });
    mountPipelinePage("/runs/e");
    await flush();
    const sheet = sequenceSheet();
    expect(
      sheet.querySelector('[data-testid="sequence-beat-label"]')?.textContent,
    ).toBe("spawn Implementor (composer)");
    const expand = sheet.querySelector(
      '[data-testid="sequence-beat"][data-row="collapsed"] button',
    );
    if (!(expand instanceof HTMLElement)) {
      throw new Error("missing expand control");
    }
    act(() => {
      expand.click();
    });
    const turnLabels = Array.from(
      sheet.querySelectorAll(
        '[data-testid="sequence-beat"][data-row="turn"] [data-testid="sequence-beat-label"]',
      ),
    ).map((el) => el.textContent);
    expect(turnLabels).toEqual([
      "spawn Implementor (composer)",
      "spawn Implementor (sonnet)",
    ]);
    expect(sheet.querySelector('[data-testid="sequence-to"]')?.textContent).toBe(
      "Implementor",
    );
  });

  it("draws an open spawn on the phone rail with a cyan dashed arrow", async () => {
    mockViewport(390);
    stubRuns(FIVE_RUNS, {
      e: {
        condition: "completed",
        lifelines: [
          { id: "human", label: "Human", kind: "human" },
          { id: "coordinator", label: "Stakeholder", kind: "coordinator" },
          { id: "retro", label: "Retro", kind: "role" },
        ],
        sections: [],
        beats: [
          {
            from: "coordinator",
            to: "retro",
            label: "spawn Retro",
            startedAt: "2026-08-28T13:00:00.000Z",
            kind: "spawn",
            indeterminate: true,
          },
        ],
      },
    });
    mountPipelinePage("/runs/e");
    await flush();
    const sheet = sequenceSheet();
    const diagram = sheet.querySelector('[data-testid="run-sequence-diagram"]');
    expect(diagram?.getAttribute("data-layout")).toBe("phone");
    const label = sheet.querySelector('[data-testid="sequence-beat-label"]');
    expect(label?.textContent).toBe("spawn Retro");
    expect(label?.textContent).not.toMatch(/no return/);
    expect(label?.closest("p")?.className).toContain("hsl(var(--current))");
    expect(sheet.querySelector(".animate-spin")).toBeNull();
    const arrow = sheet.querySelector(
      '[data-testid="sequence-arrow"][data-kind="spawn"]',
    );
    expect(arrow?.getAttribute("data-indeterminate")).toBe("true");
    expect(
      arrow?.querySelector('[data-testid="sequence-arrow-open-head"]'),
    ).not.toBeNull();
  });

  const PHONE_NESTED_SECTIONS: RunSequenceSection[] = [
    { beatStart: 0, beatEnd: 0, children: [] },
    {
      issueId: "pipeline-fixes",
      kind: "epic",
      title: "Pipeline fixes",
      beatStart: 1,
      beatEnd: 4,
      children: [
        {
          issueId: "run-status-semantics",
          kind: "story",
          title: "Run status semantics",
          beatStart: 1,
          beatEnd: 2,
          children: [],
        },
        {
          issueId: "diagram-grouping",
          kind: "story",
          title: "Diagram issue grouping",
          beatStart: 3,
          beatEnd: 4,
          children: [],
        },
      ],
    },
  ];

  function phoneSectionHeaders(container: ParentNode) {
    return Array.from(
      container.querySelectorAll('[data-testid="sequence-section"]'),
    ).map((el) => ({
      kind: el.getAttribute("data-kind"),
      title: el.querySelector('[data-testid="sequence-section-title"]')
        ?.textContent,
      expanded: el.getAttribute("aria-expanded"),
    }));
  }

  it("renders issue section headers on the phone rail", async () => {
    mockViewport(390);
    stubRuns(FIVE_RUNS, {
      e: {
        condition: "completed",
        lifelines: [
          { id: "human", label: "human", kind: "human" },
          { id: "coordinator", label: "planning", kind: "coordinator" },
          { id: "research", label: "research", kind: "role" },
        ],
        sections: PHONE_NESTED_SECTIONS,
        beats: [
          {
            from: "human",
            to: "coordinator",
            label: "human replied",
            startedAt: "2026-08-28T12:00:00.000Z",
            kind: "human-turn",
          },
          {
            from: "coordinator",
            to: "research",
            label: "spawn research",
            startedAt: "2026-08-28T12:01:00.000Z",
            durationMs: 45_000,
            kind: "spawn",
          },
          {
            from: "research",
            to: "coordinator",
            label: "research returned",
            startedAt: "2026-08-28T12:01:45.000Z",
            durationMs: 92_000,
            kind: "return",
          },
          {
            from: "coordinator",
            to: "research",
            label: "spawn git",
            startedAt: "2026-08-28T12:03:00.000Z",
            durationMs: 22_000,
            kind: "spawn",
          },
          {
            from: "research",
            to: "coordinator",
            label: "git returned",
            startedAt: "2026-08-28T12:03:22.000Z",
            durationMs: 180_000,
            kind: "return",
          },
        ],
      },
    });
    mountPipelinePage("/runs/e");
    await flush();
    const sheet = sequenceSheet();
    expect(
      sheet.querySelector('[data-testid="run-sequence-diagram"]')?.getAttribute(
        "data-layout",
      ),
    ).toBe("phone");
    expect(phoneSectionHeaders(sheet)).toEqual([
      { kind: "epic", title: "Pipeline fixes", expanded: "true" },
      { kind: "story", title: "Run status semantics", expanded: "true" },
      { kind: "story", title: "Diagram issue grouping", expanded: "true" },
    ]);
    expect(
      Array.from(sheet.querySelectorAll('[data-testid="sequence-beat"]')).map(
        (el) => el.getAttribute("data-beat-index"),
      ),
    ).toEqual(["0", "1", "2", "3", "4"]);
  });

  it("collapsing a phone rail section hides only its own beats", async () => {
    mockViewport(390);
    stubRuns(FIVE_RUNS, {
      e: {
        condition: "completed",
        lifelines: [
          { id: "human", label: "human", kind: "human" },
          { id: "coordinator", label: "planning", kind: "coordinator" },
          { id: "research", label: "research", kind: "role" },
        ],
        sections: PHONE_NESTED_SECTIONS,
        beats: [
          {
            from: "human",
            to: "coordinator",
            label: "human replied",
            startedAt: "2026-08-28T12:00:00.000Z",
            kind: "human-turn",
          },
          {
            from: "coordinator",
            to: "research",
            label: "spawn research",
            startedAt: "2026-08-28T12:01:00.000Z",
            durationMs: 45_000,
            kind: "spawn",
          },
          {
            from: "research",
            to: "coordinator",
            label: "research returned",
            startedAt: "2026-08-28T12:01:45.000Z",
            durationMs: 92_000,
            kind: "return",
          },
          {
            from: "coordinator",
            to: "research",
            label: "spawn git",
            startedAt: "2026-08-28T12:03:00.000Z",
            durationMs: 22_000,
            kind: "spawn",
          },
          {
            from: "research",
            to: "coordinator",
            label: "git returned",
            startedAt: "2026-08-28T12:03:22.000Z",
            durationMs: 180_000,
            kind: "return",
          },
        ],
      },
    });
    mountPipelinePage("/runs/e");
    await flush();
    const sheet = sequenceSheet();
    const story = Array.from(
      sheet.querySelectorAll('[data-testid="sequence-section"]'),
    ).find(
      (el) =>
        el.querySelector('[data-testid="sequence-section-title"]')
          ?.textContent === "Run status semantics",
    );
    if (!(story instanceof HTMLElement)) {
      throw new Error("missing story section header");
    }
    act(() => {
      story.click();
    });
    expect(story.getAttribute("aria-expanded")).toBe("false");
    expect(
      Array.from(sheet.querySelectorAll('[data-testid="sequence-beat"]')).map(
        (el) => el.getAttribute("data-beat-index"),
      ),
    ).toEqual(["0", "3", "4"]);
    expect(phoneSectionHeaders(sheet)).toEqual([
      { kind: "epic", title: "Pipeline fixes", expanded: "true" },
      { kind: "story", title: "Run status semantics", expanded: "false" },
      { kind: "story", title: "Diagram issue grouping", expanded: "true" },
    ]);
  });

  it("renders every fetched run at phone width with no elision", async () => {
    mockViewport(390);
    stubRuns(FIVE_RUNS);
    const { container } = mountPipelinePage("/runs/e");
    await flush();
    expect(
      runCards(container).map((el) => el.getAttribute("data-conversation-id")),
    ).toEqual(["a", "b", "c", "d", "e"]);
    expect(
      container.querySelector('[data-testid="pipeline-run-elision"]'),
    ).toBeNull();
  });

  it("shows the recovered marker beside the condition chip on recovered runs only", async () => {
    stubRuns([
      {
        ...recentRun("clean", "completed", "2026-08-28T15:00:00.000Z"),
      },
      {
        ...recentRun("recovered", "completed", "2026-08-28T14:00:00.000Z"),
        recoveredErrors: 2,
      },
    ]);
    const { container } = mountPipelinePage("/runs");
    await flush();

    const clean = runCard(container, "clean");
    expect(clean.querySelector('[data-condition="completed"]')?.textContent).toBe(
      "done",
    );
    expect(
      clean.querySelector('[data-testid="pipeline-run-recovered-marker"]'),
    ).toBeNull();

    const recovered = runCard(container, "recovered");
    expect(
      recovered.querySelector('[data-condition="completed"]')?.textContent,
    ).toBe("done");
    const marker = recovered.querySelector(
      '[data-testid="pipeline-run-recovered-marker"]',
    );
    expect(marker?.textContent).toBe("↻2");
    expect(marker?.className).toContain("hsl(var(--warn))");
  });

  it("uses the current treatment for a selected failed run the same as a completed one", async () => {
    stubRuns([
      recentRun("done-run", "completed", "2026-08-28T15:00:00.000Z"),
      recentRun("fail-run", "failed", "2026-08-28T14:00:00.000Z"),
    ]);
    const { container } = mountPipelinePage("/runs/fail-run");
    await flush();
    const selectedFailed = runCard(container, "fail-run");
    const unselectedDone = runCard(container, "done-run");
    expect(selectedFailed.getAttribute("data-current")).toBe("true");
    expect(unselectedDone.getAttribute("data-current")).toBeNull();
    expect(selectedFailed.className).toContain("hsl(var(--current))");
    expect(unselectedDone.className).not.toContain("hsl(var(--current))");

    act(() => {
      unselectedDone.click();
    });
    await flush();
    const selectedDone = runCard(container, "done-run");
    const unselectedFailed = runCard(container, "fail-run");
    expect(selectedDone.getAttribute("data-current")).toBe("true");
    expect(unselectedFailed.getAttribute("data-current")).toBeNull();
    expect(selectedDone.className).toContain("hsl(var(--current))");
    expect(unselectedFailed.className).not.toContain("hsl(var(--current))");
    expect(unselectedFailed.getAttribute("data-condition")).toBe("failed");
    expect(selectedDone.getAttribute("data-condition")).toBe("completed");
  });

  it("shows pending while the step source is in flight", async () => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    const { container } = mountPipelinePage("/pipelines?step=grill");
    await flush();
    const panel = sourcePanel(container);
    expect(panel.textContent).toContain("Loading step source…");
    expect(panel.textContent).toContain("skills/issue-tracker-plan/SKILL.md");
    expect(panel.querySelector("h1")).toBeNull();
  });

  it("fetches and renders the selected step's markdown", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        source: "skills/issue-tracker-plan/SKILL.md",
        markdown: "# Grill-me protocol\n\nA selected step's defining prose.",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { container } = mountPipelinePage("/pipelines");
    act(() => {
      nodeEl(container, "grill").click();
    });
    expect(nodeEl(container, "grill").getAttribute("data-current")).toBe("true");
    expect(container.textContent).toContain("Loading step source…");

    await flush();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/pipeline/steps/grill/source",
      expect.anything(),
    );
    const panel = sourcePanel(container);
    expect(panel.textContent).toContain("skills/issue-tracker-plan/SKILL.md");
    expect(panel.textContent).toContain("A selected step's defining prose.");
    expect(panel.querySelector("h1")?.textContent).toBe("Grill-me protocol");
    expect(
      container.querySelector('[data-testid="location-probe"]')?.textContent,
    ).toBe("/pipelines?step=grill");
  });

  it("shows a failed fetch and dismisses back to the undecorated diagram", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ error: "pipeline step not found: grill" }, 404),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { container } = mountPipelinePage("/pipelines?step=grill");
    await flush();

    const panel = sourcePanel(container);
    expect(panel.textContent).toContain("pipeline step not found: grill");
    expect(panel.textContent).toContain("Check the server, then try again.");
    expect(nodeEl(container, "grill").getAttribute("data-current")).toBe("true");

    const close = panel.querySelector('[aria-label="Close"]');
    if (!(close instanceof HTMLElement)) {
      throw new Error("Missing close");
    }
    act(() => {
      close.click();
    });

    expect(
      container.querySelector('[data-testid="pipeline-step-source-panel"]'),
    ).toBeNull();
    expect(nodeEl(container, "grill").getAttribute("data-current")).toBeNull();
    expect(
      container.querySelector('[data-testid="location-probe"]')?.textContent,
    ).toBe("/pipelines");
  });

  it("opens a top sheet with a pinned header at phone width", async () => {
    mockViewport(390);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        source: "skills/issue-tracker-plan/SKILL.md",
        markdown: "Phone sheet prose.",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { container } = mountPipelinePage("/pipelines?step=grill");
    await flush();
    expect(
      container.querySelector('[data-testid="pipeline-step-source-panel"]'),
    ).toBeNull();
    const sheet = document.querySelector(
      '[data-testid="pipeline-step-source-sheet"]',
    );
    if (!(sheet instanceof HTMLElement)) {
      throw new Error("Missing step source sheet");
    }
    expect(sheet.className).toMatch(/\btop-0\b/);
    expect(sheet.querySelector('[data-testid="pipeline-step-source-header"]'))
      .toBeTruthy();
    expect(sheet.textContent).toContain("Phone sheet prose.");
    expect(sheet.textContent).toContain("skills/issue-tracker-plan/SKILL.md");
    expect(sheet.querySelector("button")?.className).toMatch(/\bmt-auto\b/);
  });

  it("does not open a panel when a handoff node is activated", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { container } = mountPipelinePage("/pipelines");
    act(() => {
      nodeEl(container, "work-handoff").click();
    });
    expect(diagram(container).getAttribute("data-pipeline")).toBe("work");
    expect(
      container.querySelector('[data-testid="pipeline-step-source-panel"]'),
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("links the selected run root issue from the sequence pane header", async () => {
    stubRuns(FIVE_RUNS, {
      c: {
        condition: "completed",
        lifelines: [
          { id: "human", label: "human", kind: "human" },
          { id: "coordinator", label: "planning", kind: "coordinator" },
        ],
        sections: [],
        beats: [],
        rootIssue: {
          id: "root-task",
          kind: "task",
          title: "First task",
          projectId: "issue-tracker",
        },
      },
    });
    const { container } = mountPipelinePage("/runs/c");
    await flush();

    const link = container.querySelector(
      '[data-testid="run-sequence-root-issue-link"]',
    );
    expect(link).not.toBeNull();
    expect(link?.textContent).toBe("First task");
    expect(link?.getAttribute("href")).toBe(
      "/projects/issue-tracker/issues/root-task",
    );
    expect(container.textContent).toContain("Task");
  });

  it("renders no root issue link when the run has no root issue", async () => {
    stubRuns(FIVE_RUNS, {
      c: {
        condition: "completed",
        lifelines: [
          { id: "human", label: "human", kind: "human" },
          { id: "coordinator", label: "planning", kind: "coordinator" },
        ],
        sections: [],
        beats: [],
      },
    });
    const { container } = mountPipelinePage("/runs/c");
    await flush();

    expect(
      container.querySelector('[data-testid="run-sequence-root-issue-link"]'),
    ).toBeNull();
  });

  it("keeps the sequence pane header height when root issue is absent", async () => {
    const runs = [
      recentRun("with-root", "completed", "2026-08-28T15:00:00.000Z"),
      recentRun("no-root", "completed", "2026-08-28T14:00:00.000Z"),
    ];
    stubRuns(runs, {
      "with-root": {
        condition: "completed",
        lifelines: [
          { id: "human", label: "human", kind: "human" },
          { id: "coordinator", label: "planning", kind: "coordinator" },
        ],
        sections: [],
        beats: [],
        rootIssue: {
          id: "root-task",
          kind: "task",
          title: "First task",
          projectId: "issue-tracker",
        },
      },
      "no-root": {
        condition: "completed",
        lifelines: [
          { id: "human", label: "human", kind: "human" },
          { id: "coordinator", label: "planning", kind: "coordinator" },
        ],
        sections: [],
        beats: [],
      },
    });
    const withIssue = mountPipelinePage("/runs/with-root");
    await flush();
    const withHeight = sequencePaneHeader(withIssue.container).offsetHeight;

    const withoutIssue = mountPipelinePage("/runs/no-root");
    await flush();
    const withoutHeight = sequencePaneHeader(withoutIssue.container).offsetHeight;

    expect(withHeight).toBe(withoutHeight);

    act(() => {
      withIssue.root.unmount();
      withoutIssue.root.unmount();
    });
  });
});
