// @vitest-environment happy-dom
import type { TranscriptEvent } from "@server/schemas";
import { act } from "react";
import { type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  mountThread,
  resetThreadMocks,
  threadUi,
  transcriptState,
} from "./conversation-thread.test-helpers";

const AT = "2026-01-01T00:00:00.000Z";

function usage(runId?: string): TranscriptEvent {
  return {
    type: "usage",
    at: AT,
    usage: {
      totalTokens: 10,
      inputTokens: 4,
      outputTokens: 6,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    ...(runId !== undefined ? { runId } : {}),
  };
}

function settled(runId: string, rawCostCents: number): TranscriptEvent[] {
  return [
    {
      type: "run_usage",
      at: AT,
      runId,
      agentId: "agent-1",
      usage: {
        totalTokens: 10,
        inputTokens: 4,
        outputTokens: 6,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    },
    {
      type: "run_cost",
      at: AT,
      runId,
      agentId: "agent-1",
      status: "settled",
      cumulative: { rawCostCents, chargedCents: 0 },
      cost: { rawCostCents, chargedCents: 0 },
    },
  ];
}

function stripText(container: HTMLElement): string {
  return (
    container.querySelector('[data-testid="thread-status-strip"]')?.textContent ??
    ""
  );
}

describe("thread status strip cost clause", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
    resetThreadMocks();
  });

  function mount(events: TranscriptEvent[], runActive = false): string {
    transcriptState.events = events;
    threadUi.runActive = runActive;
    ({ container, root } = mountThread("conv-1"));
    return stripText(container!);
  }

  it("appends a settled total after the token clauses", () => {
    const text = mount([
      { type: "prompt", at: AT, text: "go" },
      usage("run-1"),
      ...settled("run-1", 30),
    ]);
    expect(text).toContain("10 tokens · in 4 · out 6 · $0.30");
    expect(text).toContain("idle");
  });

  it("shows cost pending during a run", () => {
    const text = mount(
      [{ type: "prompt", at: AT, text: "go" }, usage("run-live")],
      true,
    );
    expect(text).toContain(" · cost pending");
    expect(text).toContain("running");
  });

  it("shows cost pending after the run and before cost settles", () => {
    const text = mount([
      { type: "prompt", at: AT, text: "go" },
      usage("run-1"),
      {
        type: "run_usage",
        at: AT,
        runId: "run-1",
        agentId: "agent-1",
        usage: {
          totalTokens: 10,
          inputTokens: 4,
          outputTokens: 6,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      },
    ]);
    expect(text).toContain(" · cost pending");
    expect(text).not.toContain("$");
  });

  it("shows cost unavailable", () => {
    const text = mount([
      { type: "prompt", at: AT, text: "go" },
      {
        type: "run_usage",
        at: AT,
        runId: "run-1",
        agentId: "agent-1",
        usage: {
          totalTokens: 10,
          inputTokens: 4,
          outputTokens: 6,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      },
      {
        type: "run_cost",
        at: AT,
        runId: "run-1",
        agentId: "agent-1",
        status: "unavailable",
      },
    ]);
    expect(text).toContain(" · cost unavailable");
  });

  it("omits the cost clause for a legacy-only thread", () => {
    const text = mount([
      { type: "prompt", at: AT, text: "old" },
      usage(),
    ]);
    expect(text).toContain("10 tokens · in 4 · out 6");
    expect(text).not.toContain("cost");
    expect(text).not.toContain("$");
  });

  it("qualifies a mixed legacy thread", () => {
    const text = mount([
      { type: "prompt", at: AT, text: "old" },
      usage(),
      { type: "prompt", at: AT, text: "new" },
      ...settled("run-1", 12),
    ]);
    expect(text).toContain(" · $0.12 (1 of 2 runs)");
  });
});
