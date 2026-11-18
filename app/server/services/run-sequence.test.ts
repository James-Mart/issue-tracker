import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TranscriptEvent } from "../schemas.js";
import {
  AT,
  AT_CHILD,
  AT_END,
  loadRunSequence,
  prompt,
  setupRunSequenceTest,
  teardownRunSequenceTest,
  writeConversation,
} from "./run-sequence.fixtures.js";

beforeEach(() => {
  setupRunSequenceTest();
});

afterEach(() => {
  teardownRunSequenceTest();
});

function streamUsage(opts: {
  totalTokens: number;
  at: string;
  seq: number;
  runId: string;
}): TranscriptEvent {
  return {
    type: "usage",
    usage: {
      inputTokens: opts.totalTokens,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: opts.totalTokens,
    },
    at: opts.at,
    seq: opts.seq,
    runId: opts.runId,
  };
}

function runUsage(opts: {
  totalTokens: number;
  at: string;
  seq: number;
  runId: string;
  agentId: string;
}): TranscriptEvent {
  return {
    type: "run_usage",
    runId: opts.runId,
    agentId: opts.agentId,
    usage: {
      inputTokens: opts.totalTokens,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: opts.totalTokens,
    },
    at: opts.at,
    seq: opts.seq,
  };
}

describe("attributeUsage", () => {
  it("counts a settled run from run_usage and ignores that run's stream events", async () => {
    writeConversation("conv-settled", {
      meta: { channel: "planning", issueId: "capture", createdAt: AT },
      transcript: [
        prompt("go", AT, 1),
        streamUsage({ totalTokens: 100, at: AT_END, seq: 2, runId: "run-root" }),
        streamUsage({ totalTokens: 40, at: AT_END, seq: 3, runId: "run-root" }),
        runUsage({
          totalTokens: 70,
          at: AT_CHILD,
          seq: 4,
          runId: "run-root",
          agentId: "agent-root",
        }),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-settled");

    expect(sequence.tokenTotal).toBe(70);
    expect(sequence.beats[0]).toMatchObject({
      kind: "human-turn",
      tokenTotal: 70,
    });
  });
});
