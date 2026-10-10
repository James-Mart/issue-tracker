import { describe, expect, it } from "vitest";
import type { TranscriptEvent } from "@server/schemas";
import { deriveTurns } from "./transcript-rows";

const at = "2026-01-01T00:00:00.000Z";

function usageAt(seq: number): TranscriptEvent {
  return {
    type: "usage",
    at,
    seq,
    usage: {
      totalTokens: 1,
      inputTokens: 1,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  };
}

describe("deriveTurns", () => {
  it("groups by stored seq first even when the array is out of order", () => {
    expect(
      deriveTurns([
        usageAt(3),
        { type: "assistant", at, seq: 2, text: "one" },
        { type: "prompt", at, seq: 4, text: "second" },
        { type: "prompt", at, seq: 1, text: "first" },
        { type: "assistant", at, seq: 5, text: "two" },
      ]),
    ).toEqual([
      { lastAssistantSeq: 2, lastEventSeq: 3, isLastTurn: false },
      { lastAssistantSeq: 5, lastEventSeq: 5, isLastTurn: true },
    ]);
  });
});

