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
import { PIPELINE_RUNS_LIMIT, type RecentRun } from "../run-list";
import type { RunSequence } from "../run-sequence";
import { pipelines } from "../shape";
import { PipelinePage } from "./pipeline-page";

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
            <Route path="/pipeline" element={<PipelinePage />} />
            <Route path="/pipeline/runs" element={<PipelinePage />} />
            <Route
              path="/pipeline/runs/:conversationId"
              element={<PipelinePage />}
            />
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
      return Promise.resolve(jsonResponse({ runs }));
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

function mockViewport(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
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
  notifyManager.setScheduler((cb) => {
    setTimeout(cb, 0);
  });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PipelinePage", () => {
  it("renders the planning pipeline diagram on /pipeline", () => {
    const { container } = mountPipelinePage("/pipeline");
    expect(diagram(container).getAttribute("data-pipeline")).toBe("planning");
    expect(container.textContent).toContain("Planning");
    expect(tab(container, "Design").getAttribute("aria-selected")).toBe("true");
  });

  it("offers every declared pipeline and defaults to planning", () => {
    const { container } = mountPipelinePage("/pipeline");
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
    const { container } = mountPipelinePage("/pipeline");
    act(() => {
      tab(container, "Work the stack").click();
    });
    expect(diagram(container).getAttribute("data-pipeline")).toBe("work");
    expect(tab(container, "Work the stack").getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(
      container.querySelector('[data-testid="location-probe"]')?.textContent,
    ).toBe("/pipeline?pipeline=work");
    expect(container.textContent).toContain("Implementor");
    expect(container.textContent).not.toContain("Grill-me protocol");
  });

  it("draws the pipeline named in the query string", () => {
    const { container } = mountPipelinePage("/pipeline?pipeline=work");
    expect(diagram(container).getAttribute("data-pipeline")).toBe("work");
    expect(tab(container, "Work the stack").getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("switches the canvas when a handoff node is activated", () => {
    const { container } = mountPipelinePage("/pipeline");
    act(() => {
      nodeEl(container, "work-handoff").click();
    });
    expect(diagram(container).getAttribute("data-pipeline")).toBe("work");
    expect(nodeEl(container, "planning-handoff").getAttribute("data-target-pipeline")).toBe(
      "planning",
    );
    expect(
      container.querySelector('[data-testid="location-probe"]')?.textContent,
    ).toBe("/pipeline?pipeline=work");

    act(() => {
      nodeEl(container, "planning-handoff").click();
    });
    expect(diagram(container).getAttribute("data-pipeline")).toBe("planning");
    expect(
      container.querySelector('[data-testid="location-probe"]')?.textContent,
    ).toBe("/pipeline");
  });

  it("navigates to /pipeline/runs when Runs is selected", async () => {
    stubRuns();
    const { container } = mountPipelinePage("/pipeline");
    act(() => {
      tab(container, "Runs").click();
    });
    await flush();
    expect(
      container.querySelector('[data-testid="location-probe"]')?.textContent,
    ).toBe("/pipeline/runs");
    expect(container.textContent).toContain("Recent runs");
    expect(tab(container, "Runs").getAttribute("aria-selected")).toBe("true");
  });

  it("navigates to /pipeline when Design is selected from runs", () => {
    stubRuns();
    const { container } = mountPipelinePage("/pipeline/runs");
    act(() => {
      tab(container, "Design").click();
    });
    expect(
      container.querySelector('[data-testid="location-probe"]')?.textContent,
    ).toBe("/pipeline");
    expect(
      container.querySelector('[data-testid="pipeline-diagram"]'),
    ).not.toBeNull();
  });

  it("renders every fetched run newest-first at desktop width", async () => {
    const fetchMock = stubRuns(FIVE_RUNS);
    const { container } = mountPipelinePage("/pipeline/runs");
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

  it("routes selection to /pipeline/runs/:conversationId", async () => {
    stubRuns(FIVE_RUNS);
    const { container } = mountPipelinePage("/pipeline/runs");
    await flush();
    act(() => {
      runCard(container, "c").click();
    });
    await flush();
    expect(
      container.querySelector('[data-testid="location-probe"]')?.textContent,
    ).toBe("/pipeline/runs/c");
    expect(runCard(container, "c").getAttribute("data-current")).toBe("true");
    expect(runCard(container, "c").getAttribute("aria-current")).toBe("true");
  });

  it("marks the run named in the route as selected", async () => {
    stubRuns(FIVE_RUNS);
    const { container } = mountPipelinePage("/pipeline/runs/d");
    await flush();
    expect(tab(container, "Runs").getAttribute("aria-selected")).toBe("true");
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
    const { container } = mountPipelinePage("/pipeline/runs/c");
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
    expect(
      container.querySelector('[data-testid="pipeline-run-sequence-placeholder"]'),
    ).toBeNull();
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
    const { container } = mountPipelinePage("/pipeline/runs/e");
    await flush();
    const diagram = container.querySelector(
      '[data-testid="run-sequence-diagram"]',
    );
    expect(diagram?.getAttribute("data-layout")).toBe("phone");
    expect(container.textContent).toContain("human replied");
    expect(container.querySelector('[data-testid="sequence-from"]')?.textContent).toBe(
      "human",
    );
    expect(container.querySelector('[data-testid="sequence-to"]')?.textContent).toBe(
      "planning",
    );
    expect(
      container.querySelector('[data-testid="pipeline-run-sequence-placeholder"]'),
    ).toBeNull();
  });

  it("pins the selected run and newest failed run when the phone list is truncated", async () => {
    mockViewport(390);
    stubRuns(FIVE_RUNS);
    const { container } = mountPipelinePage("/pipeline/runs/e");
    await flush();
    expect(
      runCards(container).map((el) => el.getAttribute("data-conversation-id")),
    ).toEqual(["a", "d", "e"]);
    const elision = container.querySelector(
      '[data-testid="pipeline-run-elision"]',
    );
    if (!(elision instanceof HTMLElement)) {
      throw new Error("Missing elision");
    }
    expect(elision.textContent).toContain("2 omitted");
    expect(elision.textContent).toContain("b, c");
    expect(elision.getAttribute("aria-label")).toBe("2 runs omitted: b, c");
    const list = container.querySelector('[data-testid="pipeline-run-list"]');
    expect(list?.textContent).toMatch(/a.*2 omitted.*b, c.*d.*e/s);
  });

  it("uses the current treatment for a selected failed run the same as a completed one", async () => {
    stubRuns([
      recentRun("done-run", "completed", "2026-08-28T15:00:00.000Z"),
      recentRun("fail-run", "failed", "2026-08-28T14:00:00.000Z"),
    ]);
    const { container } = mountPipelinePage("/pipeline/runs/fail-run");
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
    const { container } = mountPipelinePage("/pipeline?step=grill");
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

    const { container } = mountPipelinePage("/pipeline");
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
    ).toBe("/pipeline?step=grill");
  });

  it("shows a failed fetch and dismisses back to the undecorated diagram", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ error: "pipeline step not found: grill" }, 404),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { container } = mountPipelinePage("/pipeline?step=grill");
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
    ).toBe("/pipeline");
  });

  it("opens a bottom sheet at phone width", async () => {
    mockViewport(390);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        source: "skills/issue-tracker-plan/SKILL.md",
        markdown: "Phone sheet prose.",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { container } = mountPipelinePage("/pipeline?step=grill");
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
    expect(sheet.textContent).toContain("Phone sheet prose.");
    expect(sheet.textContent).toContain("skills/issue-tracker-plan/SKILL.md");
  });

  it("does not open a panel when a handoff node is activated", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { container } = mountPipelinePage("/pipeline");
    act(() => {
      nodeEl(container, "work-handoff").click();
    });
    expect(diagram(container).getAttribute("data-pipeline")).toBe("work");
    expect(
      container.querySelector('[data-testid="pipeline-step-source-panel"]'),
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
