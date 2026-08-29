import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DelegationRecord,
  DelegationRecordWithEnd,
  TranscriptEvent,
} from "../schemas.js";
import type { RunSequenceSection } from "./run-sequence.js";

const AT = "2026-07-09T14:00:00.000Z";
const AT_EARLY = "2026-07-09T13:00:00.000Z";
const AT_CHILD = "2026-07-09T14:05:00.000Z";
const AT_END = "2026-07-09T14:00:05.000Z";
const AT_ROUND1_END = "2026-07-09T14:00:03.000Z";
const AT_ROUND2_END = "2026-07-09T14:00:06.000Z";
const AT_ROUND3_END = "2026-07-09T14:00:09.000Z";
const AT_LATE = "2026-07-09T16:00:00.000Z";
const AT_LATE_END = "2026-07-09T16:00:06.000Z";

let root: string;
let conversationsDir: string;
let issuesDir: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(issuesDir, id), { recursive: true });
  writeFileSync(
    join(issuesDir, id, "issue.json"),
    JSON.stringify({ id, ...body }),
  );
}

function writeConversation(
  id: string,
  opts: {
    delegations?: DelegationRecordWithEnd[];
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
  const lines: unknown[] = [];
  for (const record of opts.delegations ?? []) {
    const { end, ...start } = record;
    lines.push(start);
    if (end !== undefined) {
      lines.push({
        kind: "end",
        delegationId: start.delegationId,
        status: end.status,
        endedAt: end.endedAt,
        ...(end.failureClass !== undefined
          ? { failureClass: end.failureClass }
          : {}),
      });
    }
  }
  writeFileSync(
    join(dir, "delegations.jsonl"),
    lines.map((line) => JSON.stringify(line)).join("\n") +
      (lines.length ? "\n" : ""),
  );
  const transcript = opts.transcript ?? [];
  writeFileSync(
    join(dir, "transcript.jsonl"),
    transcript.map((e) => JSON.stringify(e)).join("\n") +
      (transcript.length ? "\n" : ""),
  );
}

function delegation(
  overrides: Partial<DelegationRecordWithEnd> &
    Pick<
      DelegationRecord,
      "delegationId" | "agentId" | "role" | "model" | "at"
    >,
): DelegationRecordWithEnd {
  const lifecycle =
    "lifecycle" in overrides ? overrides.lifecycle : "tracked";
  return {
    delegationId: overrides.delegationId,
    agentId: overrides.agentId,
    role: overrides.role,
    model: overrides.model,
    at: overrides.at,
    ...(lifecycle !== undefined ? { lifecycle } : {}),
    ...(overrides.issueId !== undefined ? { issueId: overrides.issueId } : {}),
    ...(overrides.parentCallId !== undefined
      ? { parentCallId: overrides.parentCallId }
      : {}),
    ...(overrides.parentDelegationId !== undefined
      ? { parentDelegationId: overrides.parentDelegationId }
      : {}),
    ...(overrides.end !== undefined ? { end: overrides.end } : {}),
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

function subagentToolCall(
  opts: {
    parentCallId: string;
    callId: string;
    status: "running" | "completed" | "error";
    at: string;
    seq: number;
    delegationId?: string;
  },
): TranscriptEvent {
  return {
    type: "subagent_update",
    parentCallId: opts.parentCallId,
    step: {
      kind: "tool_call",
      callId: opts.callId,
      name: "delegate",
      status: opts.status,
    },
    at: opts.at,
    seq: opts.seq,
    ...(opts.delegationId !== undefined
      ? { delegationId: opts.delegationId }
      : {}),
  };
}

function prompt(text: string, at: string, seq: number): TranscriptEvent {
  return { type: "prompt", text, at, seq };
}

function writeWorkTree(): void {
  writeIssue("proj", {
    kind: "project",
    title: "Proj",
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("epic-one", {
    kind: "epic",
    title: "Epic One",
    partOf: "proj",
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("story-one", {
    kind: "story",
    title: "Story One",
    partOf: "epic-one",
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("task-a", {
    kind: "task",
    title: "Task A",
    partOf: "story-one",
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("task-b", {
    kind: "task",
    title: "Task B",
    partOf: "story-one",
    createdAt: AT,
    updatedAt: AT,
  });
}

function expectLeafCoverage(
  sections: RunSequenceSection[],
  beatCount: number,
): void {
  const covered: number[] = [];
  function walk(nodes: RunSequenceSection[]): void {
    for (let i = 1; i < nodes.length; i += 1) {
      expect(nodes[i]!.beatStart).toBe(nodes[i - 1]!.beatEnd + 1);
    }
    for (const node of nodes) {
      expect(node.beatStart).toBeLessThanOrEqual(node.beatEnd);
      if (node.children.length === 0) {
        for (let i = node.beatStart; i <= node.beatEnd; i += 1) {
          covered.push(i);
        }
      } else {
        expect(node.children[0]!.beatStart).toBe(node.beatStart);
        expect(node.children[node.children.length - 1]!.beatEnd).toBe(
          node.beatEnd,
        );
        walk(node.children);
      }
    }
  }
  walk(sections);
  expect(covered).toEqual([...Array(beatCount).keys()]);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-run-sequence-"));
  conversationsDir = join(root, "conversations");
  issuesDir = join(root, "issues");
  mkdirSync(conversationsDir, { recursive: true });
  mkdirSync(issuesDir, { recursive: true });
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesDir);
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
          end: { status: "completed", endedAt: AT_CHILD },
        }),
        delegation({
          delegationId: "del-mockup",
          agentId: "agent-mockup",
          role: "mockup-author",
          model: "composer-2.5",
          at: AT_EARLY,
          parentCallId: "call-mockup",
          end: { status: "completed", endedAt: AT },
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
      "mockup-author returned",
      "research returned",
    ]);
    expect(sequence.beats.map((b) => [b.from, b.to])).toEqual([
      ["human", "coordinator"],
      ["coordinator", "research"],
      ["coordinator", "mockup-author"],
      ["mockup-author", "coordinator"],
      ["research", "coordinator"],
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
          end: { status: "completed", endedAt: AT_CHILD },
        }),
        delegation({
          delegationId: "del-qa",
          agentId: "agent-qa",
          role: "validator",
          model: "composer-2.5",
          at: AT,
          parentCallId: "call-qa",
          parentDelegationId: "del-impl",
          end: { status: "completed", endedAt: AT_END },
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

  it("marks the run in-flight when an error return is followed by an open spawn", async () => {
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
          end: { status: "error", endedAt: AT_END },
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

    expect(sequence.condition).toBe("in-flight");
    expect(sequence.recoveredErrors).toBe(1);
    expect(sequence.beats.find((b) => b.kind === "return")).toEqual({
      from: "mockup-author",
      to: "coordinator",
      label: "mockup-author failed",
      startedAt: AT_END,
      durationMs: Date.parse(AT_END) - Date.parse(AT),
      kind: "return",
    });
  });

  it("reports completed with recoveredErrors when an error is followed by later success", async () => {
    writeConversation("conv-recovered", {
      meta: { issueId: "capture", channel: "planning" },
      delegations: [
        delegation({
          delegationId: "del-mockup",
          agentId: "agent-mockup",
          role: "mockup-author",
          model: "composer-2.5",
          at: AT,
          parentCallId: "call-mockup",
          end: { status: "error", endedAt: AT_END },
        }),
        delegation({
          delegationId: "del-research",
          agentId: "agent-research",
          role: "research",
          model: "composer-2.5",
          at: AT_CHILD,
          parentCallId: "call-research",
          end: { status: "completed", endedAt: AT_LATE },
        }),
      ],
      transcript: [
        toolCall("call-mockup", "running", AT, 1),
        toolCall("call-mockup", "error", AT_END, 2),
        toolCall("call-research", "running", AT_CHILD, 3),
        toolCall("call-research", "completed", AT_LATE, 4),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-recovered");

    expect(sequence.condition).toBe("completed");
    expect(sequence.recoveredErrors).toBe(1);
  });

  it("marks the run failed when the final beat is an error return", async () => {
    writeConversation("conv-terminal-failed", {
      meta: { issueId: "capture", channel: "planning" },
      delegations: [
        delegation({
          delegationId: "del-mockup",
          agentId: "agent-mockup",
          role: "mockup-author",
          model: "composer-2.5",
          at: AT,
          parentCallId: "call-mockup",
          end: { status: "error", endedAt: AT_END },
        }),
      ],
      transcript: [
        toolCall("call-mockup", "running", AT, 1),
        toolCall("call-mockup", "error", AT_END, 2),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-terminal-failed");

    expect(sequence.condition).toBe("failed");
    expect(sequence).not.toHaveProperty("recoveredErrors");
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
          end: { status: "completed", endedAt: AT_ROUND1_END },
        }),
        delegation({
          delegationId: "del-polish-2",
          agentId: "agent-polish-2",
          role: "polish",
          model: "composer-2.5",
          at: AT,
          parentCallId: "call-polish-2",
          end: { status: "completed", endedAt: AT_ROUND2_END },
        }),
        delegation({
          delegationId: "del-polish-3",
          agentId: "agent-polish-3",
          role: "polish",
          model: "composer-2.5",
          at: AT,
          parentCallId: "call-polish-3",
          end: { status: "completed", endedAt: AT_ROUND3_END },
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
          end: { status: "completed", endedAt: AT_ROUND1_END },
        }),
        delegation({
          delegationId: "del-research",
          agentId: "agent-research",
          role: "research",
          model: "composer-2.5",
          at: AT_CHILD,
          parentCallId: "call-research",
          end: { status: "completed", endedAt: AT_END },
        }),
        delegation({
          delegationId: "del-polish-2",
          agentId: "agent-polish-2",
          role: "polish",
          model: "composer-2.5",
          at: AT_LATE,
          parentCallId: "call-polish-2",
          end: { status: "completed", endedAt: AT_ROUND2_END },
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
          end: { status: "completed", endedAt: AT_END },
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

  it("closes a spawn from the end record when the transcript has no matching tool_call", async () => {
    writeConversation("conv-end-without-call", {
      meta: { issueId: "capture", channel: "planning" },
      delegations: [
        delegation({
          delegationId: "del-research",
          agentId: "agent-research",
          role: "research",
          model: "composer-2.5",
          at: AT,
          parentCallId: "call-research",
          end: { status: "completed", endedAt: AT_END },
        }),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-end-without-call");

    expect(sequence.condition).toBe("completed");
    expect(sequence.beats).toEqual([
      {
        from: "coordinator",
        to: "research",
        label: "spawn research",
        startedAt: AT,
        durationMs: Date.parse(AT_END) - Date.parse(AT),
        kind: "spawn",
        parentCallId: "call-research",
      },
      {
        from: "research",
        to: "coordinator",
        label: "research returned",
        startedAt: AT_END,
        durationMs: Date.parse(AT_END) - Date.parse(AT),
        kind: "return",
      },
    ]);
  });

  it("closes a tracked record without an end from a terminal tool_call", async () => {
    writeConversation("conv-tracked-terminal", {
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
      transcript: [toolCall("call-research", "completed", AT_END, 1)],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-tracked-terminal");

    expect(sequence.condition).toBe("completed");
    expect(sequence.beats).toEqual([
      {
        from: "coordinator",
        to: "research",
        label: "spawn research",
        startedAt: AT,
        durationMs: Date.parse(AT_END) - Date.parse(AT),
        kind: "spawn",
        parentCallId: "call-research",
      },
      {
        from: "research",
        to: "coordinator",
        label: "research returned",
        startedAt: AT_END,
        durationMs: Date.parse(AT_END) - Date.parse(AT),
        kind: "return",
      },
    ]);
    expect(sequence.beats[0]).not.toHaveProperty("indeterminate");
  });

  it("closes an untracked record without an end from a terminal tool_call", async () => {
    writeConversation("conv-untracked", {
      meta: { issueId: "capture", channel: "planning" },
      delegations: [
        delegation({
          delegationId: "del-research",
          agentId: "agent-research",
          role: "research",
          model: "composer-2.5",
          at: AT,
          parentCallId: "call-research",
          lifecycle: undefined,
        }),
      ],
      transcript: [toolCall("call-research", "completed", AT_END, 1)],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-untracked");

    expect(sequence.condition).toBe("completed");
    expect(sequence.beats).toEqual([
      {
        from: "coordinator",
        to: "research",
        label: "spawn research",
        startedAt: AT,
        durationMs: Date.parse(AT_END) - Date.parse(AT),
        kind: "spawn",
        parentCallId: "call-research",
      },
      {
        from: "research",
        to: "coordinator",
        label: "research returned",
        startedAt: AT_END,
        durationMs: Date.parse(AT_END) - Date.parse(AT),
        kind: "return",
      },
    ]);
    expect(sequence.beats[0]).not.toHaveProperty("indeterminate");
  });

  it("closes an untracked record from a terminal subagent_update", async () => {
    writeConversation("conv-untracked-subagent", {
      meta: { issueId: "capture", channel: "planning" },
      delegations: [
        delegation({
          delegationId: "del-research",
          agentId: "agent-research",
          role: "research",
          model: "composer-2.5",
          at: AT,
          parentCallId: "call-research",
          lifecycle: undefined,
        }),
      ],
      transcript: [
        subagentToolCall({
          parentCallId: "call-research",
          callId: "call-nested",
          status: "completed",
          at: AT_END,
          seq: 1,
          delegationId: "del-research",
        }),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-untracked-subagent");

    expect(sequence.condition).toBe("completed");
    expect(sequence.beats).toEqual([
      {
        from: "coordinator",
        to: "research",
        label: "spawn research",
        startedAt: AT,
        durationMs: Date.parse(AT_END) - Date.parse(AT),
        kind: "spawn",
        parentCallId: "call-research",
      },
      {
        from: "research",
        to: "coordinator",
        label: "research returned",
        startedAt: AT_END,
        durationMs: Date.parse(AT_END) - Date.parse(AT),
        kind: "return",
      },
    ]);
  });

  it("maps a transcript error signal like a persisted error end", async () => {
    writeConversation("conv-transcript-error", {
      meta: { issueId: "capture", channel: "planning" },
      delegations: [
        delegation({
          delegationId: "del-research",
          agentId: "agent-research",
          role: "research",
          model: "composer-2.5",
          at: AT,
          parentCallId: "call-research",
          lifecycle: undefined,
        }),
      ],
      transcript: [toolCall("call-research", "error", AT_END, 1)],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-transcript-error");

    expect(sequence.condition).toBe("failed");
    expect(sequence.beats.find((b) => b.kind === "return")).toEqual({
      from: "research",
      to: "coordinator",
      label: "research failed",
      startedAt: AT_END,
      durationMs: Date.parse(AT_END) - Date.parse(AT),
      kind: "return",
    });
  });

  it("prefers a persisted end over a terminal transcript signal", async () => {
    writeConversation("conv-end-wins", {
      meta: { issueId: "capture", channel: "planning" },
      delegations: [
        delegation({
          delegationId: "del-research",
          agentId: "agent-research",
          role: "research",
          model: "composer-2.5",
          at: AT,
          parentCallId: "call-research",
          end: { status: "completed", endedAt: AT_END },
        }),
      ],
      transcript: [
        toolCall("call-research", "running", AT, 1),
        toolCall("call-research", "error", AT_LATE, 2),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-end-wins");

    expect(sequence.condition).toBe("completed");
    expect(sequence.beats).toEqual([
      {
        from: "coordinator",
        to: "research",
        label: "spawn research",
        startedAt: AT,
        durationMs: Date.parse(AT_END) - Date.parse(AT),
        kind: "spawn",
        parentCallId: "call-research",
      },
      {
        from: "research",
        to: "coordinator",
        label: "research returned",
        startedAt: AT_END,
        durationMs: Date.parse(AT_END) - Date.parse(AT),
        kind: "return",
      },
    ]);
  });

  it("flags an untracked record as indeterminate when the transcript has no signals", async () => {
    writeConversation("conv-untracked-empty", {
      meta: { issueId: "capture", channel: "planning" },
      delegations: [
        delegation({
          delegationId: "del-research",
          agentId: "agent-research",
          role: "research",
          model: "composer-2.5",
          at: AT,
          parentCallId: "call-research",
          lifecycle: undefined,
        }),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-untracked-empty");

    expect(sequence.condition).toBe("completed");
    expect(sequence.beats).toEqual([
      {
        from: "coordinator",
        to: "research",
        label: "spawn research",
        startedAt: AT,
        kind: "spawn",
        parentCallId: "call-research",
        indeterminate: true,
      },
    ]);
    expect(sequence.beats[0]).not.toHaveProperty("durationMs");
  });

  it("flags an untracked record as indeterminate when the transcript has only a running signal", async () => {
    writeConversation("conv-untracked-running", {
      meta: { issueId: "capture", channel: "planning" },
      delegations: [
        delegation({
          delegationId: "del-research",
          agentId: "agent-research",
          role: "research",
          model: "composer-2.5",
          at: AT,
          parentCallId: "call-research",
          lifecycle: undefined,
        }),
      ],
      transcript: [toolCall("call-research", "running", AT, 1)],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-untracked-running");

    expect(sequence.condition).toBe("completed");
    expect(sequence.beats).toEqual([
      {
        from: "coordinator",
        to: "research",
        label: "spawn research",
        startedAt: AT,
        kind: "spawn",
        parentCallId: "call-research",
        indeterminate: true,
      },
    ]);
    expect(sequence.beats[0]).not.toHaveProperty("durationMs");
  });

  it("collapses an indeterminate group without inventing a duration", async () => {
    writeConversation("conv-indeterminate-collapse", {
      meta: { issueId: "capture", channel: "planning" },
      delegations: [
        delegation({
          delegationId: "del-polish-1",
          agentId: "agent-polish-1",
          role: "polish",
          model: "composer-2.5",
          at: AT,
          parentCallId: "call-polish-1",
          lifecycle: undefined,
        }),
        delegation({
          delegationId: "del-polish-2",
          agentId: "agent-polish-2",
          role: "polish",
          model: "composer-2.5",
          at: AT,
          parentCallId: "call-polish-2",
          lifecycle: undefined,
        }),
      ],
      transcript: [
        toolCall("call-polish-1", "running", AT, 1),
        toolCall("call-polish-2", "running", AT, 2),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-indeterminate-collapse");

    expect(sequence.condition).toBe("completed");
    expect(sequence.beats).toEqual([
      {
        from: "coordinator",
        to: "polish",
        label: "spawn polish",
        startedAt: AT,
        kind: "spawn",
        parentCallId: "call-polish-2",
        indeterminate: true,
        turns: [
          { label: "spawn polish", startedAt: AT },
          { label: "spawn polish", startedAt: AT },
        ],
      },
    ]);
    expect(sequence.beats[0]).not.toHaveProperty("durationMs");
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

  it("resolves rootIssue from the earliest delegation issue", async () => {
    writeIssue("platform", {
      kind: "project",
      title: "Platform",
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("first-issue", {
      kind: "task",
      title: "First task",
      partOf: "platform",
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("second-issue", {
      kind: "task",
      title: "Second task",
      partOf: "platform",
      createdAt: AT,
      updatedAt: AT,
    });
    writeConversation("conv-root-issue", {
      meta: {
        channel: "implementing",
        issueId: "first-issue",
        createdAt: AT,
      },
      delegations: [
        delegation({
          delegationId: "del-first",
          agentId: "agent-first",
          role: "implementor",
          model: "composer-2.5",
          at: AT,
          issueId: "first-issue",
          parentCallId: "call-first",
          end: { status: "completed", endedAt: AT_END },
        }),
        delegation({
          delegationId: "del-second",
          agentId: "agent-second",
          role: "validator",
          model: "composer-2.5",
          at: AT_LATE,
          issueId: "second-issue",
          parentCallId: "call-second",
          end: { status: "completed", endedAt: AT_LATE },
        }),
      ],
      transcript: [
        toolCall("call-first", "running", AT, 1),
        toolCall("call-first", "completed", AT_END, 2),
        toolCall("call-second", "running", AT_LATE, 3),
        toolCall("call-second", "completed", AT_LATE, 4),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-root-issue");

    expect(sequence.rootIssue).toEqual({
      id: "first-issue",
      kind: "task",
      title: "First task",
      projectId: "platform",
    });
  });

  it("omits rootIssue when no delegation carries an issueId", async () => {
    writeConversation("conv-no-issue", {
      meta: { title: "Ad hoc debug", createdAt: AT },
      delegations: [
        delegation({
          delegationId: "del-research",
          agentId: "agent-research",
          role: "research",
          model: "composer-2.5",
          at: AT,
          parentCallId: "call-research",
          end: { status: "completed", endedAt: AT_END },
        }),
      ],
      transcript: [
        toolCall("call-research", "running", AT, 1),
        toolCall("call-research", "completed", AT_END, 2),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-no-issue");

    expect(sequence).not.toHaveProperty("rootIssue");
  });

  it("derives one lifeline per role family and names each model variant on beats", async () => {
    writeConversation("conv-variant-implementors", {
      meta: { issueId: "capture", channel: "implementing" },
      delegations: [
        delegation({
          delegationId: "del-composer",
          agentId: "agent-composer",
          role: "issue-tracker-implementor-composer",
          model: "composer-2.5",
          at: AT,
          parentCallId: "call-composer",
          end: { status: "completed", endedAt: AT_ROUND1_END },
        }),
        delegation({
          delegationId: "del-sonnet",
          agentId: "agent-sonnet",
          role: "issue-tracker-implementor-sonnet",
          model: "claude-sonnet",
          at: AT,
          parentCallId: "call-sonnet",
          end: { status: "completed", endedAt: AT_ROUND2_END },
        }),
      ],
      transcript: [
        toolCall("call-composer", "running", AT, 1),
        toolCall("call-sonnet", "running", AT, 2),
        toolCall("call-composer", "completed", AT_ROUND1_END, 3),
        toolCall("call-sonnet", "completed", AT_ROUND2_END, 4),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-variant-implementors");

    expect(sequence.lifelines).toEqual([
      { id: "coordinator", label: "implementing", kind: "coordinator" },
      {
        id: "issue-tracker-implementor",
        label: "issue-tracker-implementor",
        kind: "role",
      },
    ]);
    expect(sequence.beats).toHaveLength(2);
    expect(sequence.beats[0]).toEqual({
      from: "coordinator",
      to: "issue-tracker-implementor",
      label: "spawn issue-tracker-implementor (composer)",
      startedAt: AT,
      durationMs: Date.parse(AT_ROUND2_END) - Date.parse(AT),
      kind: "spawn",
      parentCallId: "call-sonnet",
      turns: [
        {
          label: "spawn issue-tracker-implementor (composer)",
          startedAt: AT,
          durationMs: Date.parse(AT_ROUND1_END) - Date.parse(AT),
        },
        {
          label: "spawn issue-tracker-implementor (sonnet)",
          startedAt: AT,
          durationMs: Date.parse(AT_ROUND2_END) - Date.parse(AT),
        },
      ],
    });
    expect(sequence.beats[1]).toEqual({
      from: "issue-tracker-implementor",
      to: "coordinator",
      label: "issue-tracker-implementor (composer) returned",
      startedAt: AT_ROUND1_END,
      durationMs: 9000,
      kind: "return",
      turns: [
        {
          label: "issue-tracker-implementor (composer) returned",
          startedAt: AT_ROUND1_END,
          durationMs: Date.parse(AT_ROUND1_END) - Date.parse(AT),
        },
        {
          label: "issue-tracker-implementor (sonnet) returned",
          startedAt: AT_ROUND2_END,
          durationMs: Date.parse(AT_ROUND2_END) - Date.parse(AT),
        },
      ],
    });
  });

  it("omits rootIssue when the earliest issue id no longer resolves", async () => {
    writeConversation("conv-dangling", {
      meta: { title: "Historical run", createdAt: AT },
      delegations: [
        delegation({
          delegationId: "del-gone",
          agentId: "agent-gone",
          role: "implementor",
          model: "composer-2.5",
          at: AT,
          issueId: "deleted-issue",
          parentCallId: "call-gone",
          end: { status: "completed", endedAt: AT_END },
        }),
      ],
      transcript: [
        toolCall("call-gone", "running", AT, 1),
        toolCall("call-gone", "completed", AT_END, 2),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-dangling");

    expect(sequence).not.toHaveProperty("rootIssue");
    expect(sequence.sections).toEqual([
      { beatStart: 0, beatEnd: 1, children: [] },
    ]);
  });

  it("wraps a planning run in the session issue when delegations disagree", async () => {
    writeWorkTree();
    writeConversation("conv-planning-session", {
      meta: { channel: "planning", issueId: "story-one", createdAt: AT },
      delegations: [
        delegation({
          delegationId: "del-polish",
          agentId: "agent-polish",
          role: "polish",
          model: "composer-2.5",
          at: AT,
          issueId: "task-a",
          parentCallId: "call-polish",
          end: { status: "completed", endedAt: AT_ROUND1_END },
        }),
        delegation({
          delegationId: "del-research",
          agentId: "agent-research",
          role: "research",
          model: "composer-2.5",
          at: AT_CHILD,
          parentCallId: "call-research",
          end: { status: "completed", endedAt: AT_END },
        }),
        delegation({
          delegationId: "del-mockup",
          agentId: "agent-mockup",
          role: "mockup-author",
          model: "composer-2.5",
          at: AT_LATE,
          issueId: "task-b",
          parentCallId: "call-mockup",
          end: { status: "completed", endedAt: AT_LATE_END },
        }),
      ],
      transcript: [
        prompt("refine scope", AT_EARLY, 1),
        toolCall("call-polish", "running", AT, 2),
        toolCall("call-polish", "completed", AT_ROUND1_END, 3),
        toolCall("call-research", "running", AT_CHILD, 4),
        toolCall("call-research", "completed", AT_END, 5),
        toolCall("call-mockup", "running", AT_LATE, 6),
        toolCall("call-mockup", "completed", AT_LATE_END, 7),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-planning-session");

    expect(sequence.rootIssue).toEqual({
      id: "story-one",
      kind: "story",
      title: "Story One",
      projectId: "proj",
    });
    expect(sequence.sections).toEqual([
      {
        issueId: "epic-one",
        kind: "epic",
        title: "Epic One",
        beatStart: 0,
        beatEnd: 6,
        children: [
          {
            issueId: "story-one",
            kind: "story",
            title: "Story One",
            beatStart: 0,
            beatEnd: 6,
            children: [],
          },
        ],
      },
    ]);
    expectLeafCoverage(sequence.sections, sequence.beats.length);
  });

  it("nests two Tasks under one Story and keeps a mid-run human in the open section", async () => {
    writeWorkTree();
    writeConversation("conv-nested-tasks", {
      meta: { channel: "implementing", issueId: "task-a", createdAt: AT },
      delegations: [
        delegation({
          delegationId: "del-a",
          agentId: "agent-a",
          role: "implementor",
          model: "composer-2.5",
          at: AT,
          issueId: "task-a",
          parentCallId: "call-a",
          end: { status: "completed", endedAt: AT_ROUND1_END },
        }),
        delegation({
          delegationId: "del-b",
          agentId: "agent-b",
          role: "implementor",
          model: "composer-2.5",
          at: AT_LATE,
          issueId: "task-b",
          parentCallId: "call-b",
          end: { status: "completed", endedAt: AT_LATE_END },
        }),
      ],
      transcript: [
        prompt("start", AT_EARLY, 1),
        toolCall("call-a", "running", AT, 2),
        toolCall("call-a", "completed", AT_ROUND1_END, 3),
        prompt("continue", AT_CHILD, 4),
        toolCall("call-b", "running", AT_LATE, 5),
        toolCall("call-b", "completed", AT_LATE_END, 6),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-nested-tasks");

    expect(sequence.beats.map((b) => b.label)).toEqual([
      "human replied",
      "spawn implementor",
      "implementor returned",
      "human replied",
      "spawn implementor",
      "implementor returned",
    ]);
    expect(sequence.sections).toEqual([
      { beatStart: 0, beatEnd: 0, children: [] },
      {
        issueId: "epic-one",
        kind: "epic",
        title: "Epic One",
        beatStart: 1,
        beatEnd: 5,
        children: [
          {
            issueId: "story-one",
            kind: "story",
            title: "Story One",
            beatStart: 1,
            beatEnd: 5,
            children: [
              {
                issueId: "task-a",
                kind: "task",
                title: "Task A",
                beatStart: 1,
                beatEnd: 3,
                children: [],
              },
              {
                issueId: "task-b",
                kind: "task",
                title: "Task B",
                beatStart: 4,
                beatEnd: 5,
                children: [],
              },
            ],
          },
        ],
      },
    ]);
    expectLeafCoverage(sequence.sections, sequence.beats.length);
  });

  it("does not collapse consecutive same-pair beats tagged with different issues", async () => {
    writeWorkTree();
    writeConversation("conv-no-cross-issue-collapse", {
      meta: { channel: "implementing", issueId: "task-a", createdAt: AT },
      delegations: [
        delegation({
          delegationId: "del-a",
          agentId: "agent-a",
          role: "implementor",
          model: "composer-2.5",
          at: AT,
          issueId: "task-a",
          parentCallId: "call-a",
          end: { status: "completed", endedAt: AT_ROUND1_END },
        }),
        delegation({
          delegationId: "del-b",
          agentId: "agent-b",
          role: "implementor",
          model: "composer-2.5",
          at: AT,
          issueId: "task-b",
          parentCallId: "call-b",
          end: { status: "completed", endedAt: AT_ROUND2_END },
        }),
      ],
      transcript: [
        toolCall("call-a", "running", AT, 1),
        toolCall("call-b", "running", AT, 2),
        toolCall("call-a", "completed", AT_ROUND1_END, 3),
        toolCall("call-b", "completed", AT_ROUND2_END, 4),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-no-cross-issue-collapse");

    expect(sequence.beats.map((b) => [b.kind, b.from, b.to])).toEqual([
      ["spawn", "coordinator", "implementor"],
      ["spawn", "coordinator", "implementor"],
      ["return", "implementor", "coordinator"],
      ["return", "implementor", "coordinator"],
    ]);
    expect(sequence.beats[0]).not.toHaveProperty("turns");
    expect(sequence.beats[1]).not.toHaveProperty("turns");
    expect(sequence.beats[2]).not.toHaveProperty("turns");
    expect(sequence.beats[3]).not.toHaveProperty("turns");
    expect(
      sequence.sections[0]?.children[0]?.children.map((s) => s.issueId),
    ).toEqual(["task-a", "task-b", "task-a", "task-b"]);
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
          end: { status: "completed", endedAt: AT_END },
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
          end: { status: "error", endedAt: AT_END },
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
          end: { status: "completed", endedAt: AT_END },
        }),
        delegation({
          delegationId: "del-second",
          agentId: "agent-second",
          role: "validator",
          model: "composer-2.5",
          at: AT_LATE,
          issueId: "second-issue",
          parentCallId: "call-second",
          end: { status: "completed", endedAt: AT_LATE },
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
        issueId: "capture",
      },
    ]);
  });
});
