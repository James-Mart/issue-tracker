import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DelegationRecord, TranscriptEvent } from "../schemas.js";

const AT = "2026-07-09T14:00:00.000Z";
const AT_EARLY = "2026-07-09T13:00:00.000Z";
const AT_CHILD = "2026-07-09T14:05:00.000Z";
const AT_END = "2026-07-09T14:00:05.000Z";
const AT_ROUND1_END = "2026-07-09T14:00:03.000Z";
const AT_ROUND2_END = "2026-07-09T14:00:06.000Z";
const AT_ROUND3_END = "2026-07-09T14:00:09.000Z";
const AT_LATE = "2026-07-09T16:00:00.000Z";

let root: string;
let conversationsDir: string;

function writeConversation(
  id: string,
  opts: {
    delegations?: DelegationRecord[];
    transcript?: TranscriptEvent[];
    meta?: Record<string, unknown>;
  } = {},
): void {
  const dir = join(conversationsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "meta.json"),
    `${JSON.stringify(
      {
        id,
        title: "Test conversation",
        projectId: "platform",
        model: "composer-2.5",
        createdAt: AT,
        updatedAt: AT,
        ...opts.meta,
      },
      null,
      2,
    )}\n`,
  );
  const delegations = opts.delegations ?? [];
  writeFileSync(
    join(dir, "delegations.jsonl"),
    delegations.map((d) => JSON.stringify(d)).join("\n") +
      (delegations.length ? "\n" : ""),
  );
  const transcript = opts.transcript ?? [];
  writeFileSync(
    join(dir, "transcript.jsonl"),
    transcript.map((e) => JSON.stringify(e)).join("\n") +
      (transcript.length ? "\n" : ""),
  );
}

function delegation(
  overrides: Partial<DelegationRecord> &
    Pick<
      DelegationRecord,
      "delegationId" | "agentId" | "role" | "model" | "at"
    >,
): DelegationRecord {
  return {
    delegationId: overrides.delegationId,
    agentId: overrides.agentId,
    role: overrides.role,
    model: overrides.model,
    at: overrides.at,
    ...(overrides.issueId !== undefined ? { issueId: overrides.issueId } : {}),
    ...(overrides.parentCallId !== undefined
      ? { parentCallId: overrides.parentCallId }
      : {}),
    ...(overrides.parentDelegationId !== undefined
      ? { parentDelegationId: overrides.parentDelegationId }
      : {}),
  };
}

function toolCall(
  callId: string,
  status: "running" | "completed" | "error",
  at: string,
  seq: number,
): TranscriptEvent {
  return {
    type: "tool_call",
    callId,
    name: "delegate",
    status,
    at,
    seq,
  };
}

function prompt(text: string, at: string, seq: number): TranscriptEvent {
  return { type: "prompt", text, at, seq };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-run-sequence-"));
  conversationsDir = join(root, "conversations");
  mkdirSync(conversationsDir, { recursive: true });
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", join(root, "issues"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

async function loadRunSequence() {
  const { runSequence } = await import("./run-sequence.js");
  return runSequence;
}

async function loadRecentRuns() {
  const { recentRuns } = await import("./run-sequence.js");
  return recentRuns;
}

describe("runSequence", () => {
  it("orders beats by seq across interleaved lifelines", async () => {
    writeConversation("conv-interleaved", {
      meta: { issueId: "capture", channel: "planning" },
      delegations: [
        delegation({
          delegationId: "del-research",
          agentId: "agent-research",
          role: "research",
          model: "composer-2.5",
          at: AT,
          parentCallId: "call-research",
        }),
        delegation({
          delegationId: "del-mockup",
          agentId: "agent-mockup",
          role: "mockup-author",
          model: "composer-2.5",
          at: AT_EARLY,
          parentCallId: "call-mockup",
        }),
      ],
      transcript: [
        prompt("continue", AT_LATE, 1),
        toolCall("call-research", "running", AT, 2),
        toolCall("call-mockup", "running", AT_EARLY, 3),
        toolCall("call-research", "completed", AT_CHILD, 4),
        toolCall("call-mockup", "completed", AT, 5),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-interleaved");

    expect(sequence.beats.map((b) => b.label)).toEqual([
      "human replied",
      "spawn research",
      "spawn mockup-author",
      "research returned",
      "mockup-author returned",
    ]);
    expect(sequence.beats.map((b) => [b.from, b.to])).toEqual([
      ["human", "coordinator"],
      ["coordinator", "research"],
      ["coordinator", "mockup-author"],
      ["research", "coordinator"],
      ["mockup-author", "coordinator"],
    ]);
  });

  it("gives a completed run durations and nested from/to", async () => {
    writeConversation("conv-done", {
      meta: { issueId: "ship-it", channel: "implementing" },
      delegations: [
        delegation({
          delegationId: "del-impl",
          agentId: "agent-impl",
          role: "implementor",
          model: "composer-2.5",
          at: AT,
          parentCallId: "call-impl",
        }),
        delegation({
          delegationId: "del-qa",
          agentId: "agent-qa",
          role: "validator",
          model: "composer-2.5",
          at: AT,
          parentCallId: "call-qa",
          parentDelegationId: "del-impl",
        }),
      ],
      transcript: [
        toolCall("call-impl", "running", AT, 1),
        toolCall("call-qa", "running", AT, 2),
        toolCall("call-qa", "completed", AT_END, 3),
        toolCall("call-impl", "completed", AT_CHILD, 4),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-done");

    expect(sequence.condition).toBe("completed");
    expect(sequence.lifelines).toEqual([
      { id: "coordinator", label: "implementing", kind: "coordinator" },
      { id: "implementor", label: "implementor", kind: "role" },
      { id: "validator", label: "validator", kind: "role" },
    ]);
    expect(sequence.beats).toEqual([
      {
        from: "coordinator",
        to: "implementor",
        label: "spawn implementor",
        startedAt: AT,
        durationMs: Date.parse(AT_CHILD) - Date.parse(AT),
        kind: "spawn",
        parentCallId: "call-impl",
      },
      {
        from: "implementor",
        to: "validator",
        label: "spawn validator",
        startedAt: AT,
        durationMs: Date.parse(AT_END) - Date.parse(AT),
        kind: "spawn",
        parentCallId: "call-qa",
      },
      {
        from: "validator",
        to: "implementor",
        label: "validator returned",
        startedAt: AT_END,
        durationMs: Date.parse(AT_END) - Date.parse(AT),
        kind: "return",
      },
      {
        from: "implementor",
        to: "coordinator",
        label: "implementor returned",
        startedAt: AT_CHILD,
        durationMs: Date.parse(AT_CHILD) - Date.parse(AT),
        kind: "return",
      },
    ]);
  });

  it("leaves duration off an open beat and marks the run in-flight", async () => {
    writeConversation("conv-open", {
      meta: { issueId: "capture", channel: "planning" },
      delegations: [
        delegation({
          delegationId: "del-research",
          agentId: "agent-research",
          role: "research",
          model: "composer-2.5",
          at: AT,
          parentCallId: "call-research",
        }),
      ],
      transcript: [toolCall("call-research", "running", AT, 1)],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-open");

    expect(sequence.condition).toBe("in-flight");
    expect(sequence.beats).toHaveLength(1);
    expect(sequence.beats[0]).toEqual({
      from: "coordinator",
      to: "research",
      label: "spawn research",
      startedAt: AT,
      kind: "spawn",
      parentCallId: "call-research",
    });
    expect(sequence.beats[0]).not.toHaveProperty("durationMs");
  });

  it("marks the run failed when a beat ended in error", async () => {
    writeConversation("conv-failed", {
      meta: { issueId: "capture", channel: "planning" },
      delegations: [
        delegation({
          delegationId: "del-mockup",
          agentId: "agent-mockup",
          role: "mockup-author",
          model: "composer-2.5",
          at: AT,
          parentCallId: "call-mockup",
        }),
        delegation({
          delegationId: "del-open",
          agentId: "agent-research",
          role: "research",
          model: "composer-2.5",
          at: AT_CHILD,
          parentCallId: "call-research",
        }),
      ],
      transcript: [
        toolCall("call-mockup", "running", AT, 1),
        toolCall("call-mockup", "error", AT_END, 2),
        toolCall("call-research", "running", AT_CHILD, 3),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-failed");

    expect(sequence.condition).toBe("failed");
    expect(sequence.beats.find((b) => b.kind === "return")).toEqual({
      from: "mockup-author",
      to: "coordinator",
      label: "mockup-author failed",
      startedAt: AT_END,
      durationMs: Date.parse(AT_END) - Date.parse(AT),
      kind: "return",
    });
  });

  it("collapses three consecutive same-pair beats into one with turns", async () => {
    writeConversation("conv-collapsed-polish", {
      meta: { issueId: "capture", channel: "planning" },
      delegations: [
        delegation({
          delegationId: "del-polish-1",
          agentId: "agent-polish-1",
          role: "polish",
          model: "composer-2.5",
          at: AT,
          parentCallId: "call-polish-1",
        }),
        delegation({
          delegationId: "del-polish-2",
          agentId: "agent-polish-2",
          role: "polish",
          model: "composer-2.5",
          at: AT,
          parentCallId: "call-polish-2",
        }),
        delegation({
          delegationId: "del-polish-3",
          agentId: "agent-polish-3",
          role: "polish",
          model: "composer-2.5",
          at: AT,
          parentCallId: "call-polish-3",
        }),
      ],
      transcript: [
        toolCall("call-polish-1", "running", AT, 1),
        toolCall("call-polish-2", "running", AT, 2),
        toolCall("call-polish-3", "running", AT, 3),
        toolCall("call-polish-1", "completed", AT_ROUND1_END, 4),
        toolCall("call-polish-2", "completed", AT_ROUND2_END, 5),
        toolCall("call-polish-3", "completed", AT_ROUND3_END, 6),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-collapsed-polish");

    expect(sequence.beats).toHaveLength(2);
    expect(sequence.beats[0]).toEqual({
      from: "coordinator",
      to: "polish",
      label: "spawn polish",
      startedAt: AT,
      durationMs: Date.parse(AT_ROUND3_END) - Date.parse(AT),
      kind: "spawn",
      parentCallId: "call-polish-3",
      turns: [
        {
          label: "spawn polish",
          startedAt: AT,
          durationMs: Date.parse(AT_ROUND1_END) - Date.parse(AT),
        },
        {
          label: "spawn polish",
          startedAt: AT,
          durationMs: Date.parse(AT_ROUND2_END) - Date.parse(AT),
        },
        {
          label: "spawn polish",
          startedAt: AT,
          durationMs: Date.parse(AT_ROUND3_END) - Date.parse(AT),
        },
      ],
    });
    expect(sequence.beats[1]).toEqual({
      from: "polish",
      to: "coordinator",
      label: "polish returned",
      startedAt: AT_ROUND1_END,
      durationMs: Date.parse(AT_ROUND3_END) + 9000 - Date.parse(AT_ROUND1_END),
      kind: "return",
      turns: [
        {
          label: "polish returned",
          startedAt: AT_ROUND1_END,
          durationMs: Date.parse(AT_ROUND1_END) - Date.parse(AT),
        },
        {
          label: "polish returned",
          startedAt: AT_ROUND2_END,
          durationMs: Date.parse(AT_ROUND2_END) - Date.parse(AT),
        },
        {
          label: "polish returned",
          startedAt: AT_ROUND3_END,
          durationMs: Date.parse(AT_ROUND3_END) - Date.parse(AT),
        },
      ],
    });
  });

  it("keeps non-consecutive same-pair beats separate", async () => {
    writeConversation("conv-non-consecutive", {
      meta: { issueId: "capture", channel: "planning" },
      delegations: [
        delegation({
          delegationId: "del-polish-1",
          agentId: "agent-polish-1",
          role: "polish",
          model: "composer-2.5",
          at: AT,
          parentCallId: "call-polish-1",
        }),
        delegation({
          delegationId: "del-research",
          agentId: "agent-research",
          role: "research",
          model: "composer-2.5",
          at: AT_CHILD,
          parentCallId: "call-research",
        }),
        delegation({
          delegationId: "del-polish-2",
          agentId: "agent-polish-2",
          role: "polish",
          model: "composer-2.5",
          at: AT_LATE,
          parentCallId: "call-polish-2",
        }),
      ],
      transcript: [
        toolCall("call-polish-1", "running", AT, 1),
        toolCall("call-polish-1", "completed", AT_ROUND1_END, 2),
        toolCall("call-research", "running", AT_CHILD, 3),
        toolCall("call-research", "completed", AT_END, 4),
        toolCall("call-polish-2", "running", AT_LATE, 5),
        toolCall("call-polish-2", "completed", AT_ROUND2_END, 6),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-non-consecutive");

    const polishSpawns = sequence.beats.filter(
      (b) => b.from === "coordinator" && b.to === "polish" && b.kind === "spawn",
    );
    expect(polishSpawns).toHaveLength(2);
    expect(polishSpawns[0]).not.toHaveProperty("turns");
    expect(polishSpawns[1]).not.toHaveProperty("turns");
  });

  it("omits turns on a single same-pair beat", async () => {
    writeConversation("conv-single-polish", {
      meta: { issueId: "capture", channel: "planning" },
      delegations: [
        delegation({
          delegationId: "del-polish",
          agentId: "agent-polish",
          role: "polish",
          model: "composer-2.5",
          at: AT,
          parentCallId: "call-polish",
        }),
      ],
      transcript: [
        toolCall("call-polish", "running", AT, 1),
        toolCall("call-polish", "completed", AT_END, 2),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-single-polish");

    expect(sequence.beats[0]).toEqual({
      from: "coordinator",
      to: "polish",
      label: "spawn polish",
      startedAt: AT,
      durationMs: Date.parse(AT_END) - Date.parse(AT),
      kind: "spawn",
      parentCallId: "call-polish",
    });
    expect(sequence.beats[0]).not.toHaveProperty("turns");
  });

  it("emits a human-turn beat on the human lifeline", async () => {
    writeConversation("conv-human", {
      meta: { issueId: "capture", channel: "planning" },
      transcript: [prompt("approve outline", AT, 1)],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-human");

    expect(sequence.condition).toBe("completed");
    expect(sequence.lifelines).toEqual([
      { id: "human", label: "human", kind: "human" },
      { id: "coordinator", label: "planning", kind: "coordinator" },
    ]);
    expect(sequence.beats).toEqual([
      {
        from: "human",
        to: "coordinator",
        label: "human replied",
        startedAt: AT,
        kind: "human-turn",
      },
    ]);
  });
});

describe("recentRuns", () => {
  it("returns newest-first across conversations, honors limit, and matches each run's condition", async () => {
    writeConversation("conv-old", {
      meta: {
        channel: "implementing",
        issueId: "task-old",
        createdAt: AT_EARLY,
      },
      delegations: [
        delegation({
          delegationId: "del-old",
          agentId: "agent-old",
          role: "implementor",
          model: "composer-2.5",
          at: AT_EARLY,
          issueId: "task-old",
          parentCallId: "call-old",
        }),
      ],
      transcript: [
        toolCall("call-old", "running", AT_EARLY, 1),
        toolCall("call-old", "completed", AT_END, 2),
      ],
    });

    writeConversation("conv-new", {
      meta: {
        channel: "planning",
        issueId: "task-new",
        createdAt: AT_LATE,
      },
      delegations: [
        delegation({
          delegationId: "del-new",
          agentId: "agent-new",
          role: "planner",
          model: "composer-2.5",
          at: AT_LATE,
          issueId: "task-new",
          parentCallId: "call-new",
        }),
      ],
      transcript: [toolCall("call-new", "running", AT_LATE, 1)],
    });

    writeConversation("conv-failed", {
      meta: {
        title: "Failed run",
        createdAt: AT,
      },
      delegations: [
        delegation({
          delegationId: "del-fail",
          agentId: "agent-fail",
          role: "implementor",
          model: "composer-2.5",
          at: AT,
          issueId: "task-fail",
          parentCallId: "call-fail",
        }),
      ],
      transcript: [
        toolCall("call-fail", "running", AT, 1),
        toolCall("call-fail", "error", AT_END, 2),
      ],
    });

    const recentRuns = await loadRecentRuns();
    const runSequence = await loadRunSequence();

    const all = recentRuns(10);
    expect(all.map((row) => row.conversationId)).toEqual([
      "conv-new",
      "conv-failed",
      "conv-old",
    ]);

    for (const row of all) {
      expect(row.condition).toBe(runSequence(row.conversationId).condition);
    }

    expect(all[0]).toMatchObject({
      conversationId: "conv-new",
      coordinatorLabel: "planning",
      issueId: "task-new",
      startedAt: AT_LATE,
      condition: "in-flight",
    });
    expect(all[1]).toMatchObject({
      conversationId: "conv-failed",
      coordinatorLabel: "Failed run",
      issueId: "task-fail",
      condition: "failed",
    });
    expect(all[2]).toMatchObject({
      conversationId: "conv-old",
      coordinatorLabel: "implementing",
      issueId: "task-old",
      condition: "completed",
    });

    expect(recentRuns(2).map((row) => row.conversationId)).toEqual([
      "conv-new",
      "conv-failed",
    ]);
  });

  it("uses the earliest delegation issue id when rows disagree", async () => {
    writeConversation("conv-mixed", {
      meta: { channel: "implementing", issueId: "first-issue", createdAt: AT },
      delegations: [
        delegation({
          delegationId: "del-first",
          agentId: "agent-first",
          role: "implementor",
          model: "composer-2.5",
          at: AT,
          issueId: "first-issue",
          parentCallId: "call-first",
        }),
        delegation({
          delegationId: "del-second",
          agentId: "agent-second",
          role: "validator",
          model: "composer-2.5",
          at: AT_LATE,
          issueId: "second-issue",
          parentCallId: "call-second",
        }),
      ],
      transcript: [
        toolCall("call-first", "running", AT, 1),
        toolCall("call-first", "completed", AT_END, 2),
        toolCall("call-second", "running", AT_LATE, 3),
        toolCall("call-second", "completed", AT_LATE, 4),
      ],
    });

    const recentRuns = await loadRecentRuns();
    expect(recentRuns(1)[0]?.issueId).toBe("first-issue");
  });

  it("includes a conversation with no delegations via its session root", async () => {
    writeConversation("conv-root-only", {
      meta: {
        channel: "planning",
        issueId: "capture",
        createdAt: AT,
      },
      transcript: [prompt("approve outline", AT, 1)],
    });

    const recentRuns = await loadRecentRuns();
    const runSequence = await loadRunSequence();

    expect(recentRuns(10)).toEqual([
      {
        conversationId: "conv-root-only",
        coordinatorLabel: "planning",
        startedAt: AT,
        condition: runSequence("conv-root-only").condition,
      },
    ]);
    expect(recentRuns(10)[0]).not.toHaveProperty("issueId");
  });
});
