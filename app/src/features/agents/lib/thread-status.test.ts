import { describe, expect, it } from "vitest";
import type { TranscriptEvent } from "@server/schemas";
import {
  formatUsageTotals,
  sumUsageTotals,
  threadRunLabel,
} from "./thread-status";

function usage(
  totalTokens: number,
  inputTokens: number,
  outputTokens: number,
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
