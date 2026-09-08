// @vitest-environment happy-dom
import { act } from "react";
import { describe, expect, it } from "vitest";
import {
  FIVE_RUNS,
  flush,
  mountPipelinePage,
  recentRun,
  sequencePaneHeader,
  stubRuns,
} from "./pipeline-page.test-helpers";

describe("PipelinePage header", () => {
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
