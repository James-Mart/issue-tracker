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
import type { IssueRecord } from "@server/schemas";
import { PIPELINE_RUNS_LIMIT, type RecentRun } from "../run-list";
import type { RunSequence } from "../run-sequence";
import { pipelines } from "../shape";
import { PipelinePage } from "./pipeline-page";

const issuesCatalog = vi.hoisted(() => ({
  issues: [] as IssueRecord[],
}));

vi.mock("@/features/issues/api/queries", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/features/issues/api/queries")>();
  return {
    ...actual,
    useIssuesQuery: () => ({
      data: { issues: issuesCatalog.issues, problems: [], derived: {} },
      isLoading: false,
      error: null,
    }),
  };
});

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

function sequencePaneHeader(container: ParentNode): HTMLElement {
  const el = container.querySelector('[data-testid="run-sequence-pane-header"]');
  if (!(el instanceof HTMLElement)) {
    throw new Error("Missing sequence pane header");
  }
  return el;
}

const ISSUE_TREE_T0 = "2026-08-01T00:00:00.000Z";

function seedRootIssueCatalog() {
  issuesCatalog.issues = [
    {
      id: "issue-tracker",
      kind: "project",
      title: "issue-tracker",
      order: 0,
      createdAt: ISSUE_TREE_T0,
      updatedAt: ISSUE_TREE_T0,
      archived: false,
      description: "",
      labels: [],
      workspace: "/tmp/ws",
    },
    {
      id: "root-task",
      kind: "task",
      title: "First task",
      partOf: "issue-tracker",
      order: 0,
      createdAt: ISSUE_TREE_T0,
      updatedAt: ISSUE_TREE_T0,
      archived: false,
      description: "",
      labels: [],
    },
  ];
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
  issuesCatalog.issues = [];
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

  it("names each model variant on the phone rail caption", async () => {
    mockViewport(390);
    stubRuns(FIVE_RUNS, {
      e: {
        condition: "completed",
        lifelines: [
          { id: "coordinator", label: "implementing", kind: "coordinator" },
          {
            id: "issue-tracker-implementor",
            label: "issue-tracker-implementor",
            kind: "role",
          },
        ],
        sections: [],
        beats: [
          {
            from: "coordinator",
            to: "issue-tracker-implementor",
            label: "spawn issue-tracker-implementor (composer)",
            startedAt: "2026-08-28T13:00:00.000Z",
            durationMs: 30_000,
            kind: "spawn",
            turns: [
              {
                label: "spawn issue-tracker-implementor (composer)",
                startedAt: "2026-08-28T13:00:00.000Z",
                durationMs: 12_000,
              },
              {
                label: "spawn issue-tracker-implementor (sonnet)",
                startedAt: "2026-08-28T13:00:00.000Z",
                durationMs: 18_000,
              },
            ],
          },
        ],
      },
    });
    const { container } = mountPipelinePage("/pipeline/runs/e");
    await flush();
    expect(
      container.querySelector('[data-testid="sequence-beat-label"]')?.textContent,
    ).toBe("spawn implementor (composer)");
    const expand = container.querySelector(
      '[data-testid="sequence-beat"][data-row="collapsed"] button',
    );
    if (!(expand instanceof HTMLElement)) {
      throw new Error("missing expand control");
    }
    act(() => {
      expand.click();
    });
    const turnLabels = Array.from(
      container.querySelectorAll(
        '[data-testid="sequence-beat"][data-row="turn"] [data-testid="sequence-beat-label"]',
      ),
    ).map((el) => el.textContent);
    expect(turnLabels).toEqual([
      "spawn implementor (composer)",
      "spawn implementor (sonnet)",
    ]);
    expect(
      container.querySelector('[data-testid="sequence-to"]')?.textContent,
    ).toBe("implementor");
  });

  it("draws an indeterminate spawn on the phone rail with a no-return caption", async () => {
    mockViewport(390);
    stubRuns(FIVE_RUNS, {
      e: {
        condition: "completed",
        lifelines: [
          { id: "human", label: "human", kind: "human" },
          { id: "coordinator", label: "planning", kind: "coordinator" },
          { id: "retro", label: "retro", kind: "role" },
        ],
        sections: [],
        beats: [
          {
            from: "coordinator",
            to: "retro",
            label: "spawn retro",
            startedAt: "2026-08-28T13:00:00.000Z",
            kind: "spawn",
            indeterminate: true,
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
    const label = container.querySelector('[data-testid="sequence-beat-label"]');
    expect(label?.textContent).toBe("spawn retro · no return");
    expect(label?.closest("p")?.className).toContain("hsl(var(--warn))");
    expect(container.querySelector(".animate-spin")).toBeNull();
    const arrow = container.querySelector(
      '[data-testid="sequence-arrow"][data-kind="spawn"]',
    );
    expect(arrow?.getAttribute("data-indeterminate")).toBe("true");
    expect(
      arrow?.querySelector('[data-testid="sequence-arrow-open-terminus"]'),
    ).not.toBeNull();
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
    const { container } = mountPipelinePage("/pipeline/runs");
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

  it("links the selected run root issue from the sequence pane header", async () => {
    seedRootIssueCatalog();
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
        },
      },
    });
    const { container } = mountPipelinePage("/pipeline/runs/c");
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
    seedRootIssueCatalog();
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
    const { container } = mountPipelinePage("/pipeline/runs/c");
    await flush();

    expect(
      container.querySelector('[data-testid="run-sequence-root-issue-link"]'),
    ).toBeNull();
  });

  it("keeps the sequence pane header height when root issue is absent", async () => {
    seedRootIssueCatalog();
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
    const withIssue = mountPipelinePage("/pipeline/runs/with-root");
    await flush();
    const withHeight = sequencePaneHeader(withIssue.container).offsetHeight;

    const withoutIssue = mountPipelinePage("/pipeline/runs/no-root");
    await flush();
    const withoutHeight = sequencePaneHeader(withoutIssue.container).offsetHeight;

    expect(withHeight).toBe(withoutHeight);

    act(() => {
      withIssue.root.unmount();
      withoutIssue.root.unmount();
    });
  });
});
