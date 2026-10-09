// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  flush,
  mountPipelinePage,
  recentRun,
  stubRuns,
} from "./pipeline-page.test-helpers";

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  document.title = "Issue Tracker";
});

describe("PipelinePage tab title", () => {
  it("uses fixed list titles on /pipelines and /runs", async () => {
    const pipelines = mountPipelinePage("/pipelines");
    await flush();
    expect(document.title).toBe("IT: Pipelines");
    act(() => pipelines.root.unmount());

    const runs = mountPipelinePage("/runs");
    await flush();
    expect(document.title).toBe("IT: Runs");
    act(() => runs.root.unmount());
  });

  it("uses the selected pipeline name on /pipelines?pipeline=work", async () => {
    mountPipelinePage("/pipelines?pipeline=work");
    await flush();
    expect(document.title).toBe("IT: Work the st\u2026\u00B7Pipeline");
  });

  it("uses the run label and Run suffix when a run is open", async () => {
    const run = recentRun("run-1", "completed", "2026-08-28T15:00:00.000Z");
    run.coordinatorLabel = "Stakeholder";
    stubRuns([run]);
    mountPipelinePage("/runs/run-1");
    await flush();
    expect(document.title).toBe("IT: Stakeholder\u00B7Run");
  });

  it("uses the conversation id until the run name loads", async () => {
    stubRuns([]);
    mountPipelinePage("/runs/run-1");
    await flush();
    expect(document.title).toBe("IT: run-1\u00B7Run");
  });
});
