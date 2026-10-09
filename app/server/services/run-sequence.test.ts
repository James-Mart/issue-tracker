import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TranscriptEvent } from "../schemas.js";
import { formatSequenceCostClause } from "./run-sequence-cost.js";
import {
  AT,
  AT_CHILD,
  AT_END,
  delegation,
  loadRunSequence,
  prompt,
  setupRunSequenceTest,
  teardownRunSequenceTest,
  toolCall,
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
  parentCallId?: string;
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
    ...(opts.parentCallId !== undefined
      ? { parentCallId: opts.parentCallId }
      : {}),
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

function runCost(opts: {
  at: string;
  seq: number;
  runId: string;
  rawCostCents: number;
  parentCallId?: string;
}): TranscriptEvent {
  return {
    type: "run_cost",
    runId: opts.runId,
    agentId: "agent",
    status: "settled",
    at: opts.at,
    seq: opts.seq,
    ...(opts.parentCallId !== undefined
      ? { parentCallId: opts.parentCallId }
      : {}),
    cumulative: { rawCostCents: opts.rawCostCents, chargedCents: 0 },
    cost: { rawCostCents: opts.rawCostCents, chargedCents: 0 },
  };
}

describe("attribute cost", () => {
  it("attributes settled root cost to the human-turn and nested cost to the spawn", async () => {
    writeConversation("conv-cost-split", {
      meta: { channel: "implementing", issueId: "ship-it", createdAt: AT },
      delegations: [
        delegation({
          delegationId: "del-impl",
          agentId: "agent-impl",
          role: "implementor",
          model: "composer-2.5",
          at: AT_END,
          parentCallId: "call-impl",
          end: { status: "completed", endedAt: AT_CHILD },
        }),
      ],
      transcript: [
        prompt("go", AT, 1),
        runUsage({
          totalTokens: 2800,
          at: AT_END,
          seq: 2,
          runId: "run-root",
          agentId: "agent-root",
        }),
        runCost({ at: AT_END, seq: 3, runId: "run-root", rawCostCents: 3 }),
        toolCall("call-impl", "running", AT_END, 4),
        runUsage({
          totalTokens: 42000,
          at: AT_CHILD,
          seq: 5,
          runId: "run-nested",
          agentId: "agent-impl",
          parentCallId: "call-impl",
        }),
        runCost({
          at: AT_CHILD,
          seq: 6,
          runId: "run-nested",
          rawCostCents: 30,
          parentCallId: "call-impl",
        }),
        toolCall("call-impl", "completed", AT_CHILD, 7),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-cost-split");
    const human = sequence.beats.find((beat) => beat.kind === "human-turn");
    const spawn = sequence.beats.find((beat) => beat.kind === "spawn");

    expect(formatSequenceCostClause(human?.cost)).toBe("$0.03");
    expect(formatSequenceCostClause(spawn?.cost)).toBe("$0.30");
    expect(formatSequenceCostClause(sequence.cost)).toBe("$0.33");
    const beatCents = [human, spawn].reduce(
      (sum, beat) =>
        sum +
        (beat?.cost?.runs ?? [])
          .filter((run) => run.status === "settled")
          .reduce((inner, run) => inner + run.rawCostCents, 0),
      0,
    );
    const headerCents = (sequence.cost?.runs ?? [])
      .filter((run) => run.status === "settled")
      .reduce((sum, run) => sum + run.rawCostCents, 0);
    expect(headerCents).toBe(beatCents);
  });
});
