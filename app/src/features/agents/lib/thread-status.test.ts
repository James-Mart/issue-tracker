import { describe, expect, it } from "vitest";
import type { TranscriptEvent } from "@server/schemas";
import { sumUsageTotals } from "./thread-status";

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
});

