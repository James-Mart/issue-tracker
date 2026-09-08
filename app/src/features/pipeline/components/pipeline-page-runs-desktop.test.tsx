// @vitest-environment happy-dom
import { act } from "react";
import { describe, expect, it } from "vitest";
import { PIPELINE_RUNS_LIMIT } from "../run-list";
import {
  FIVE_RUNS,
  flush,
  mountPipelinePage,
  pageEyebrow,
  recentRun,
  runCard,
  runCards,
  sequencePaneHeader,
  stubRuns,
} from "./pipeline-page.test-helpers";

describe("PipelinePage desktop runs", () => {
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
});
