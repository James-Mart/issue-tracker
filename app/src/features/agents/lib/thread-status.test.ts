import { describe, expect, it } from "vitest";
import type { TranscriptEvent } from "@server/schemas";
import {
  formatThreadCostClause,
  formatThreadStatus,
  formatUsageTotals,
  sumUsageTotals,
  threadRunLabel,
} from "./thread-status";

function usage(
  totalTokens: number,
  inputTokens: number,
  outputTokens: number,
  runId?: string,
): TranscriptEvent {
  return {
    type: "usage",
    at: "2026-01-01T00:00:00.000Z",
    usage: {
      totalTokens,
      inputTokens,
      outputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    ...(runId !== undefined ? { runId } : {}),
  };
}

describe("sumUsageTotals", () => {
  it("sums total, input, and output across several usage events", () => {
    const events: TranscriptEvent[] = [
      { type: "prompt", at: "2026-01-01T00:00:00.000Z", text: "hi" },
      usage(100, 40, 60),
      { type: "assistant", at: "2026-01-01T00:00:01.000Z", text: "ok" },
      usage(250, 90, 160),
      usage(10, 3, 7),
    ];
    expect(sumUsageTotals(events)).toEqual({
      totalTokens: 360,
      inputTokens: 133,
      outputTokens: 227,
    });
  });

  it("counts a settled run from run_usage and ignores that run's stream events", () => {
    const events: TranscriptEvent[] = [
      usage(100, 40, 60),
      usage(80, 30, 50, "run-1"),
      {
        type: "run_usage",
        at: "2026-01-01T00:00:02.000Z",
        runId: "run-1",
        agentId: "agent-1",
        usage: {
          totalTokens: 50,
          inputTokens: 20,
          outputTokens: 30,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      },
    ];
    expect(sumUsageTotals(events)).toEqual({
      totalTokens: 150,
      inputTokens: 60,
      outputTokens: 90,
    });
  });

  it("sums in-flight stream events that have a runId and no run_usage", () => {
    expect(
      sumUsageTotals([usage(12, 5, 7, "run-live")]),
    ).toEqual({ totalTokens: 12, inputTokens: 5, outputTokens: 7 });
  });

  it("sums legacy usage events that have no runId", () => {
    expect(sumUsageTotals([usage(9, 4, 5)])).toEqual({
      totalTokens: 9,
      inputTokens: 4,
      outputTokens: 5,
    });
  });

  it("returns zeros when there are no usage events", () => {
    expect(
      sumUsageTotals([
        { type: "prompt", at: "2026-01-01T00:00:00.000Z", text: "hi" },
      ]),
    ).toEqual({ totalTokens: 0, inputTokens: 0, outputTokens: 0 });
  });
});

describe("threadRunLabel", () => {
  it("reflects runActive", () => {
    expect(threadRunLabel(true)).toBe("running");
    expect(threadRunLabel(false)).toBe("idle");
  });
});

describe("formatUsageTotals", () => {
  it("formats cumulative totals for the strip", () => {
    expect(
      formatUsageTotals({
        totalTokens: 1234,
        inputTokens: 200,
        outputTokens: 1034,
      }),
    ).toBe("1,234 tokens · in 200 · out 1,034");
  });
});

const AT = "2026-01-01T00:00:00.000Z";

function prompt(text: string): TranscriptEvent {
  return { type: "prompt", at: AT, text };
}

function runUsage(runId: string): TranscriptEvent {
  return {
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
  };
}

function runCost(
  runId: string,
  status: "settled" | "unavailable",
  rawCostCents?: number,
): TranscriptEvent {
  if (status === "unavailable") {
    return {
      type: "run_cost",
      at: AT,
      runId,
      agentId: "agent-1",
      status,
    };
  }
  return {
    type: "run_cost",
    at: AT,
    runId,
    agentId: "agent-1",
    status,
    cumulative: { rawCostCents: rawCostCents ?? 0, chargedCents: 0 },
    cost: { rawCostCents: rawCostCents ?? 0, chargedCents: 0 },
  };
}

describe("formatThreadCostClause", () => {
  it("shows the settled dollar total when every run has settled cost", () => {
    const events = [
      prompt("go"),
      usage(100, 40, 60, "run-1"),
      runUsage("run-1"),
      runCost("run-1", "settled", 30),
    ];
    expect(formatThreadCostClause(events, false)).toBe("$0.30");
  });

  it("is cost pending while a non-legacy run is in flight", () => {
    const events = [prompt("go"), usage(12, 5, 7, "run-live")];
    expect(formatThreadCostClause(events, true)).toBe("cost pending");
  });

  it("is cost pending after the run ends and before cost settles", () => {
    const events = [
      prompt("go"),
      usage(100, 40, 60, "run-1"),
      runUsage("run-1"),
      runCost("run-old", "settled", 30),
    ];
    expect(formatThreadCostClause(events, false)).toBe("cost pending");
  });

  it("is cost unavailable when no run settled and one is unavailable", () => {
    const events = [prompt("go"), runUsage("run-1"), runCost("run-1", "unavailable")];
    expect(formatThreadCostClause(events, false)).toBe("cost unavailable");
  });

  it("omits the clause when every run is legacy", () => {
    const events = [prompt("old"), usage(9, 4, 5)];
    expect(formatThreadCostClause(events, false)).toBeNull();
  });

  it("qualifies a settled total when some runs are legacy", () => {
    const events = [
      prompt("old"),
      usage(9, 4, 5),
      prompt("new"),
      runUsage("run-1"),
      runCost("run-1", "settled", 12),
    ];
    expect(formatThreadCostClause(events, false)).toBe("$0.12 (1 of 2 runs)");
  });
});

describe("formatThreadStatus", () => {
  it("separates the cost clause from the token clauses with ·", () => {
    const events = [prompt("go"), runUsage("run-1"), runCost("run-1", "settled", 30)];
    expect(formatThreadStatus(events, false)).toBe(
      "10 tokens · in 4 · out 6 · $0.30",
    );
  });

  it("leaves legacy threads on the token clauses alone", () => {
    const events = [prompt("old"), usage(9, 4, 5)];
    expect(formatThreadStatus(events, false)).toBe("9 tokens · in 4 · out 5");
  });
});
