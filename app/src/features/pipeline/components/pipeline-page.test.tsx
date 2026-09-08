// @vitest-environment happy-dom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  FIVE_RUNS,
  flush,
  jsonResponse,
  mockViewport,
  mountPipelinePage,
  nodeEl,
  recentRun,
  sequencePaneHeader,
  sourcePanel,
  stubRuns,
} from "./pipeline-page.test-helpers";

describe("PipelinePage", () => {
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
