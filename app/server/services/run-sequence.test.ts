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
  runId?: string;
  parentCallId?: string;
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
    ...(opts.runId !== undefined ? { runId: opts.runId } : {}),
    ...(opts.parentCallId !== undefined
      ? { parentCallId: opts.parentCallId }
      : {}),
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

  it("sums an in-flight run's stream events when no run_usage exists", async () => {
    writeConversation("conv-inflight", {
      meta: { channel: "planning", issueId: "capture", createdAt: AT },
      transcript: [
        prompt("go", AT, 1),
        streamUsage({ totalTokens: 12, at: AT_END, seq: 2, runId: "run-live" }),
        streamUsage({ totalTokens: 8, at: AT_END, seq: 3, runId: "run-live" }),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-inflight");

    expect(sequence.tokenTotal).toBe(20);
    expect(sequence.beats[0]).toMatchObject({ tokenTotal: 20 });
  });

  it("sums legacy usage events that have no runId", async () => {
    writeConversation("conv-legacy", {
      meta: { channel: "planning", issueId: "capture", createdAt: AT },
      transcript: [
        prompt("go", AT, 1),
        streamUsage({ totalTokens: 15, at: AT_END, seq: 2 }),
        streamUsage({ totalTokens: 5, at: AT_END, seq: 3 }),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-legacy");

    expect(sequence.tokenTotal).toBe(20);
  });

  it("attributes a nested run_usage to its spawn beat", async () => {
    writeConversation("conv-nested", {
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
        toolCall("call-impl", "running", AT_END, 1),
        streamUsage({
          totalTokens: 900,
          at: AT_END,
          seq: 2,
          runId: "run-nested",
          parentCallId: "call-impl",
        }),
        runUsage({
          totalTokens: 400,
          at: AT_CHILD,
          seq: 3,
          runId: "run-nested",
          agentId: "agent-impl",
          parentCallId: "call-impl",
        }),
        toolCall("call-impl", "completed", AT_CHILD, 4),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-nested");

    expect(sequence.tokenTotal).toBe(400);
    expect(sequence.beats[0]).toMatchObject({
      kind: "spawn",
      tokenTotal: 400,
    });
  });
});

function runCost(opts: {
  at: string;
  seq: number;
  runId: string;
  rawCostCents?: number;
  status?: "settled" | "unavailable";
  parentCallId?: string;
}): TranscriptEvent {
  const status = opts.status ?? "settled";
  return {
    type: "run_cost",
    runId: opts.runId,
    agentId: "agent",
    status,
    at: opts.at,
    seq: opts.seq,
    ...(opts.parentCallId !== undefined
      ? { parentCallId: opts.parentCallId }
      : {}),
    ...(status === "settled"
      ? {
          cumulative: { rawCostCents: opts.rawCostCents ?? 0, chargedCents: 0 },
          cost: { rawCostCents: opts.rawCostCents ?? 0, chargedCents: 0 },
        }
      : {}),
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

  it("is cost pending while a non-legacy run has no run_cost", async () => {
    writeConversation("conv-cost-pending", {
      meta: { channel: "planning", issueId: "capture", createdAt: AT },
      transcript: [
        prompt("go", AT, 1),
        streamUsage({ totalTokens: 12, at: AT_END, seq: 2, runId: "run-live" }),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-cost-pending");
    expect(formatSequenceCostClause(sequence.beats[0]?.cost)).toBe("cost pending");
    expect(formatSequenceCostClause(sequence.cost)).toBe("cost pending");
  });

  it("is cost unavailable when the only finished run has no bill", async () => {
    writeConversation("conv-cost-unavailable", {
      meta: { channel: "planning", issueId: "capture", createdAt: AT },
      transcript: [
        prompt("go", AT, 1),
        runUsage({
          totalTokens: 40,
          at: AT_END,
          seq: 2,
          runId: "run-root",
          agentId: "agent-root",
        }),
        runCost({ at: AT_END, seq: 3, runId: "run-root", status: "unavailable" }),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-cost-unavailable");
    expect(formatSequenceCostClause(sequence.beats[0]?.cost)).toBe(
      "cost unavailable",
    );
    expect(formatSequenceCostClause(sequence.cost)).toBe("cost unavailable");
  });

  it("qualifies a mix of settled and legacy runs", async () => {
    writeConversation("conv-cost-mixed", {
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
        streamUsage({ totalTokens: 15, at: AT_END, seq: 2 }),
        toolCall("call-impl", "running", AT_END, 3),
        runUsage({
          totalTokens: 400,
          at: AT_CHILD,
          seq: 4,
          runId: "run-nested",
          agentId: "agent-impl",
          parentCallId: "call-impl",
        }),
        runCost({
          at: AT_CHILD,
          seq: 5,
          runId: "run-nested",
          rawCostCents: 12,
          parentCallId: "call-impl",
        }),
        toolCall("call-impl", "completed", AT_CHILD, 6),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-cost-mixed");
    const human = sequence.beats.find((beat) => beat.kind === "human-turn");
    const spawn = sequence.beats.find((beat) => beat.kind === "spawn");
    expect(formatSequenceCostClause(human?.cost)).toBeUndefined();
    expect(formatSequenceCostClause(spawn?.cost)).toBe("$0.12");
    expect(formatSequenceCostClause(sequence.cost)).toBe("$0.12 (1 of 2 runs)");
  });
});
