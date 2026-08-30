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

function writeRunLiveMarker(conversationId: string): void {
  writeFileSync(
    join(conversationsDir, conversationId, "run-live.json"),
    `${JSON.stringify({ pid: process.pid })}\n`,
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

function usage(opts: {
  totalTokens: number;
  at: string;
  seq: number;
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
    ...(opts.parentCallId !== undefined
      ? { parentCallId: opts.parentCallId }
      : {}),
  };
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

async function loadRecentRunsPage() {
  const { recentRunsPage } = await import("./run-sequence.js");
  return recentRunsPage;
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
      "spawn Research",
      "spawn Mockup author",
    ]);
    expect(sequence.beats.map((b) => [b.from, b.to])).toEqual([
      ["human", "coordinator"],
      ["coordinator", "research"],
      ["coordinator", "mockup-author"],
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
      { id: "coordinator", label: "Coordinator", kind: "coordinator" },
      { id: "implementor", label: "Implementor", kind: "role" },
      { id: "validator", label: "validator", kind: "role" },
    ]);
    expect(sequence.beats).toEqual([
      {
        from: "coordinator",
        to: "implementor",
        label: "spawn Implementor",
        startedAt: AT,
        durationMs: Date.parse(AT_CHILD) - Date.parse(AT),
        cumulativeMs: Date.parse(AT_CHILD) - Date.parse(AT),
        kind: "spawn",
        parentCallId: "call-impl",
      },
      {
        from: "implementor",
        to: "validator",
        label: "spawn validator",
        startedAt: AT,
        durationMs: Date.parse(AT_END) - Date.parse(AT),
        cumulativeMs: Date.parse(AT_END) - Date.parse(AT),
        kind: "spawn",
        parentCallId: "call-qa",
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
      label: "spawn Research",
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
      label: "Mockup author failed",
      startedAt: AT_END,
      durationMs: Date.parse(AT_END) - Date.parse(AT),
      cumulativeMs: Date.parse(AT_END) - Date.parse(AT),
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

    expect(sequence.beats).toHaveLength(1);
    expect(sequence.beats[0]).toEqual({
      from: "coordinator",
      to: "polish",
      label: "spawn polish",
      startedAt: AT,
      durationMs: Date.parse(AT_ROUND3_END) - Date.parse(AT),
      cumulativeMs: Date.parse(AT_ROUND3_END) - Date.parse(AT),
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
      cumulativeMs: Date.parse(AT_END) - Date.parse(AT),
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
        label: "spawn Research",
        startedAt: AT,
        durationMs: Date.parse(AT_END) - Date.parse(AT),
        cumulativeMs: Date.parse(AT_END) - Date.parse(AT),
        kind: "spawn",
        parentCallId: "call-research",
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
        label: "spawn Research",
        startedAt: AT,
        durationMs: Date.parse(AT_END) - Date.parse(AT),
        cumulativeMs: Date.parse(AT_END) - Date.parse(AT),
        kind: "spawn",
        parentCallId: "call-research",
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
        label: "spawn Research",
        startedAt: AT,
        durationMs: Date.parse(AT_END) - Date.parse(AT),
        cumulativeMs: Date.parse(AT_END) - Date.parse(AT),
        kind: "spawn",
        parentCallId: "call-research",
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
        label: "spawn Research",
        startedAt: AT,
        durationMs: Date.parse(AT_END) - Date.parse(AT),
        cumulativeMs: Date.parse(AT_END) - Date.parse(AT),
        kind: "spawn",
        parentCallId: "call-research",
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
      label: "Research failed",
      startedAt: AT_END,
      durationMs: Date.parse(AT_END) - Date.parse(AT),
      cumulativeMs: Date.parse(AT_END) - Date.parse(AT),
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
        label: "spawn Research",
        startedAt: AT,
        durationMs: Date.parse(AT_END) - Date.parse(AT),
        cumulativeMs: Date.parse(AT_END) - Date.parse(AT),
        kind: "spawn",
        parentCallId: "call-research",
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
        label: "spawn Research",
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
        label: "spawn Research",
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
      { id: "human", label: "Human", kind: "human" },
      { id: "coordinator", label: "Stakeholder", kind: "coordinator" },
    ]);
    expect(sequence.beats).toEqual([
      {
        from: "human",
        to: "coordinator",
        label: "human replied",
        startedAt: AT,
        kind: "human-turn",
        cumulativeMs: 0,
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
      { id: "coordinator", label: "Coordinator", kind: "coordinator" },
      {
        id: "issue-tracker-implementor",
        label: "Implementor",
        kind: "role",
      },
    ]);
    expect(sequence.beats).toHaveLength(1);
    expect(sequence.beats[0]).toEqual({
      from: "coordinator",
      to: "issue-tracker-implementor",
      label: "spawn Implementor (composer)",
      startedAt: AT,
      durationMs: Date.parse(AT_ROUND2_END) - Date.parse(AT),
      cumulativeMs: Date.parse(AT_ROUND2_END) - Date.parse(AT),
      kind: "spawn",
      parentCallId: "call-sonnet",
      turns: [
        {
          label: "spawn Implementor (composer)",
          startedAt: AT,
          durationMs: Date.parse(AT_ROUND1_END) - Date.parse(AT),
        },
        {
          label: "spawn Implementor (sonnet)",
          startedAt: AT,
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
      { beatStart: 0, beatEnd: 0, children: [] },
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
        beatEnd: 3,
        children: [
          {
            issueId: "story-one",
            kind: "story",
            title: "Story One",
            beatStart: 0,
            beatEnd: 3,
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
      "spawn Implementor",
      "human replied",
      "spawn Implementor",
    ]);
    expect(sequence.sections).toEqual([
      { beatStart: 0, beatEnd: 0, children: [] },
      {
        issueId: "epic-one",
        kind: "epic",
        title: "Epic One",
        beatStart: 1,
        beatEnd: 3,
        children: [
          {
            issueId: "story-one",
            kind: "story",
            title: "Story One",
            beatStart: 1,
            beatEnd: 3,
            children: [
              {
                issueId: "task-a",
                kind: "task",
                title: "Task A",
                beatStart: 1,
                beatEnd: 2,
                children: [],
              },
              {
                issueId: "task-b",
                kind: "task",
                title: "Task B",
                beatStart: 3,
                beatEnd: 3,
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
    ]);
    expect(sequence.beats[0]).not.toHaveProperty("turns");
    expect(sequence.beats[1]).not.toHaveProperty("turns");
    expect(
      sequence.sections[0]?.children[0]?.children.map((s) => s.issueId),
    ).toEqual(["task-a", "task-b"]);
  });

  it("reports in-flight when delegations are closed but the run-live marker is present", async () => {
    writeConversation("conv-live-marker", {
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
        toolCall("call-research", "completed", AT_END, 2),
      ],
    });
    writeRunLiveMarker("conv-live-marker");

    const runSequence = await loadRunSequence();
    expect(runSequence("conv-live-marker").condition).toBe("in-flight");
  });

  it("reports completed when delegations are closed and no run-live marker", async () => {
    writeConversation("conv-no-marker", {
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
        toolCall("call-research", "completed", AT_END, 2),
      ],
    });

    const runSequence = await loadRunSequence();
    expect(runSequence("conv-no-marker").condition).toBe("completed");
  });

  it("attributes nested and root usage, stamps wall-clock cumulativeMs, and folds a successful spawn", async () => {
    writeConversation("conv-usage-fold", {
      meta: { channel: "planning", issueId: "capture", createdAt: AT },
      delegations: [
        delegation({
          delegationId: "del-research",
          agentId: "agent-research",
          role: "research",
          model: "composer-2.5",
          at: AT_END,
          parentCallId: "call-research",
          end: { status: "completed", endedAt: AT_CHILD },
        }),
      ],
      transcript: [
        prompt("go", AT, 1),
        usage({ totalTokens: 420, at: AT_END, seq: 2 }),
        toolCall("call-research", "running", AT_END, 3),
        usage({
          totalTokens: 19000,
          at: AT_CHILD,
          seq: 4,
          parentCallId: "call-research",
        }),
        toolCall("call-research", "completed", AT_CHILD, 5),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-usage-fold");

    expect(sequence.tokenTotal).toBe(19_420);
    expect(sequence.lifelines.map((line) => line.label)).toEqual([
      "Human",
      "Stakeholder",
      "Research",
    ]);
    expect(sequence.beats.map((b) => b.kind)).toEqual(["human-turn", "spawn"]);
    expect(sequence.beats[0]).toMatchObject({
      kind: "human-turn",
      tokenTotal: 420,
      cumulativeMs: 0,
    });
    expect(sequence.beats[1]).toMatchObject({
      kind: "spawn",
      label: "spawn Research",
      tokenTotal: 19_000,
      durationMs: Date.parse(AT_CHILD) - Date.parse(AT_END),
      cumulativeMs: Date.parse(AT_CHILD) - Date.parse(AT),
    });
    expect(sequence.beats.some((b) => b.kind === "return")).toBe(false);
  });

  it("keeps a failed spawn's own return beat and still totals its usage", async () => {
    writeConversation("conv-usage-fail", {
      meta: { channel: "implementing", issueId: "ship-it", createdAt: AT },
      delegations: [
        delegation({
          delegationId: "del-planner",
          agentId: "agent-planner",
          role: "planner-grok",
          model: "grok-4.5",
          at: AT,
          parentCallId: "call-planner",
          end: { status: "error", endedAt: AT_END },
        }),
      ],
      transcript: [
        toolCall("call-planner", "running", AT, 1),
        usage({
          totalTokens: 34_000,
          at: AT_END,
          seq: 2,
          parentCallId: "call-planner",
        }),
        toolCall("call-planner", "error", AT_END, 3),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-usage-fail");

    expect(sequence.condition).toBe("failed");
    expect(sequence.tokenTotal).toBe(34_000);
    expect(sequence.lifelines).toEqual([
      { id: "coordinator", label: "Coordinator", kind: "coordinator" },
      { id: "planner", label: "Planner", kind: "role" },
    ]);
    expect(sequence.beats[0]).toMatchObject({
      kind: "spawn",
      label: "spawn Planner (grok)",
      tokenTotal: 34_000,
      cumulativeMs: Date.parse(AT_END) - Date.parse(AT),
    });
    expect(sequence.beats[1]).toMatchObject({
      kind: "return",
      label: "Planner (grok) failed",
      cumulativeMs: Date.parse(AT_END) - Date.parse(AT),
    });
  });
});

describe("recentRunsPage", () => {
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

    const recentRunsPage = await loadRecentRunsPage();
    const runSequence = await loadRunSequence();

    const all = recentRunsPage({ limit: 10 }).runs;
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
      coordinatorLabel: "Stakeholder",
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
      coordinatorLabel: "Coordinator",
      issueId: "task-old",
      condition: "completed",
    });

    expect(
      recentRunsPage({ limit: 2 }).runs.map((row) => row.conversationId),
    ).toEqual(["conv-new", "conv-failed"]);
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

    const recentRunsPage = await loadRecentRunsPage();
    expect(recentRunsPage({ limit: 1 }).runs[0]?.issueId).toBe("first-issue");
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

    const recentRunsPage = await loadRecentRunsPage();
    const runSequence = await loadRunSequence();

    expect(recentRunsPage({ limit: 10 })).toEqual({
      runs: [
        {
          conversationId: "conv-root-only",
          coordinatorLabel: "Stakeholder",
          startedAt: AT,
          condition: runSequence("conv-root-only").condition,
          issueId: "capture",
        },
      ],
      nextCursor: null,
    });
  });

  it("hydrates transcript and delegations only for the newest limit slice", async () => {
    writeConversation("conv-oldest", {
      meta: { title: "Oldest", createdAt: AT_EARLY },
      delegations: [
        delegation({
          delegationId: "del-oldest",
          agentId: "agent-oldest",
          role: "implementor",
          model: "composer-2.5",
          at: AT_EARLY,
          issueId: "task-oldest",
          parentCallId: "call-oldest",
          end: { status: "completed", endedAt: AT },
        }),
      ],
      transcript: [
        toolCall("call-oldest", "running", AT_EARLY, 1),
        toolCall("call-oldest", "completed", AT, 2),
      ],
    });
    writeConversation("conv-old", {
      meta: { title: "Old", createdAt: AT },
      delegations: [
        delegation({
          delegationId: "del-old",
          agentId: "agent-old",
          role: "implementor",
          model: "composer-2.5",
          at: AT,
          issueId: "task-old",
          parentCallId: "call-old",
          end: { status: "error", endedAt: AT_END },
        }),
      ],
      transcript: [
        toolCall("call-old", "running", AT, 1),
        toolCall("call-old", "error", AT_END, 2),
      ],
    });
    writeConversation("conv-newer", {
      meta: {
        channel: "planning",
        issueId: "task-newer",
        createdAt: AT_CHILD,
      },
      delegations: [
        delegation({
          delegationId: "del-newer",
          agentId: "agent-newer",
          role: "planner",
          model: "composer-2.5",
          at: AT_CHILD,
          issueId: "task-newer",
          parentCallId: "call-newer",
        }),
      ],
      transcript: [toolCall("call-newer", "running", AT_CHILD, 1)],
    });
    writeConversation("conv-newest", {
      meta: {
        channel: "implementing",
        issueId: "task-newest",
        createdAt: AT_LATE,
      },
      delegations: [
        delegation({
          delegationId: "del-newest-fail",
          agentId: "agent-newest-fail",
          role: "implementor",
          model: "composer-2.5",
          at: AT,
          issueId: "task-newest",
          parentCallId: "call-newest-fail",
          end: { status: "error", endedAt: AT_END },
        }),
        delegation({
          delegationId: "del-newest-ok",
          agentId: "agent-newest-ok",
          role: "validator",
          model: "composer-2.5",
          at: AT_CHILD,
          issueId: "task-newest",
          parentCallId: "call-newest-ok",
          end: { status: "completed", endedAt: AT_LATE },
        }),
      ],
      transcript: [
        toolCall("call-newest-fail", "running", AT, 1),
        toolCall("call-newest-fail", "error", AT_END, 2),
        toolCall("call-newest-ok", "running", AT_CHILD, 3),
        toolCall("call-newest-ok", "completed", AT_LATE, 4),
      ],
    });

    const conversations = await import("./conversations.js");
    const readConversation = vi.spyOn(conversations, "readConversation");
    const readDelegations = vi.spyOn(conversations, "readDelegations");
    const { recentRunsPage } = await import("./run-sequence.js");

    const { runs } = recentRunsPage({ limit: 2 });
    const hydrated = new Set([
      ...readConversation.mock.calls.map(([id]) => id),
      ...readDelegations.mock.calls.map(([id]) => id),
    ]);

    expect([...hydrated].sort()).toEqual(["conv-newer", "conv-newest"]);
    expect(runs).toEqual([
      {
        conversationId: "conv-newest",
        coordinatorLabel: "Coordinator",
        startedAt: AT_LATE,
        condition: "completed",
        issueId: "task-newest",
        recoveredErrors: 1,
      },
      {
        conversationId: "conv-newer",
        coordinatorLabel: "Stakeholder",
        startedAt: AT_CHILD,
        condition: "in-flight",
        issueId: "task-newer",
      },
    ]);
  });

  it("derives list badges without reading the issue store or calling runSequence", async () => {
    writeWorkTree();
    writeIssue("task-on-disk", {
      kind: "task",
      title: "On disk",
      partOf: "story-one",
      createdAt: AT,
      updatedAt: AT,
    });

    writeConversation("conv-recovered", {
      meta: {
        channel: "implementing",
        issueId: "task-on-disk",
        createdAt: AT_LATE,
      },
      delegations: [
        delegation({
          delegationId: "del-fail",
          agentId: "agent-fail",
          role: "implementor",
          model: "composer-2.5",
          at: AT,
          issueId: "task-on-disk",
          parentCallId: "call-fail",
          end: { status: "error", endedAt: AT_END },
        }),
        delegation({
          delegationId: "del-ok",
          agentId: "agent-ok",
          role: "validator",
          model: "composer-2.5",
          at: AT_CHILD,
          issueId: "task-on-disk",
          parentCallId: "call-ok",
          end: { status: "completed", endedAt: AT_LATE },
        }),
      ],
      transcript: [
        toolCall("call-fail", "running", AT, 1),
        toolCall("call-fail", "error", AT_END, 2),
        toolCall("call-ok", "running", AT_CHILD, 3),
        toolCall("call-ok", "completed", AT_LATE, 4),
      ],
    });

    const issues = await import("./issues.js");
    const readAllSpy = vi.spyOn(issues, "readAll");
    const readIssueOrThrowSpy = vi.spyOn(issues, "readIssueOrThrow");
    const readSpy = vi.spyOn(issues, "read");
    const readDescriptionSpy = vi.spyOn(issues, "readDescription");

    const runSequenceModule = await import("./run-sequence.js");
    const runSequenceSpy = vi.spyOn(runSequenceModule, "runSequence");

    const { runs } = runSequenceModule.recentRunsPage({ limit: 10 });

    expect(readAllSpy).not.toHaveBeenCalled();
    expect(readIssueOrThrowSpy).not.toHaveBeenCalled();
    expect(readSpy).not.toHaveBeenCalled();
    expect(readDescriptionSpy).not.toHaveBeenCalled();
    expect(runSequenceSpy).not.toHaveBeenCalled();

    expect(runs).toEqual([
      {
        conversationId: "conv-recovered",
        coordinatorLabel: "Coordinator",
        startedAt: AT_LATE,
        condition: "completed",
        issueId: "task-on-disk",
        recoveredErrors: 1,
      },
    ]);
  });

  it("reports in-flight when the run-live marker overrides a completed beat verdict", async () => {
    writeConversation("conv-live-list", {
      meta: {
        channel: "planning",
        issueId: "task-live",
        createdAt: AT_LATE,
      },
      delegations: [
        delegation({
          delegationId: "del-live",
          agentId: "agent-live",
          role: "planner",
          model: "composer-2.5",
          at: AT_LATE,
          issueId: "task-live",
          parentCallId: "call-live",
          end: { status: "completed", endedAt: AT_LATE_END },
        }),
      ],
      transcript: [
        toolCall("call-live", "running", AT_LATE, 1),
        toolCall("call-live", "completed", AT_LATE_END, 2),
      ],
    });
    writeRunLiveMarker("conv-live-list");

    const recentRunsPage = await loadRecentRunsPage();
    expect(recentRunsPage({ limit: 1 }).runs[0]?.condition).toBe("in-flight");
  });

  it("reports completed from recentRunsPage when no run-live marker is present", async () => {
    writeConversation("conv-completed-list", {
      meta: {
        channel: "planning",
        issueId: "task-done",
        createdAt: AT_LATE,
      },
      delegations: [
        delegation({
          delegationId: "del-done",
          agentId: "agent-done",
          role: "planner",
          model: "composer-2.5",
          at: AT_LATE,
          issueId: "task-done",
          parentCallId: "call-done",
          end: { status: "completed", endedAt: AT_LATE_END },
        }),
      ],
      transcript: [
        toolCall("call-done", "running", AT_LATE, 1),
        toolCall("call-done", "completed", AT_LATE_END, 2),
      ],
    });

    const recentRunsPage = await loadRecentRunsPage();
    expect(recentRunsPage({ limit: 1 }).runs[0]?.condition).toBe("completed");
  });

  it("pages newest-first with a nextCursor, no overlap or gap, and null at the end", async () => {
    writeConversation("conv-a", {
      meta: { title: "A", createdAt: AT_EARLY },
      transcript: [prompt("hi", AT_EARLY, 1)],
    });
    writeConversation("conv-b", {
      meta: { title: "B", createdAt: AT },
      transcript: [prompt("hi", AT, 1)],
    });
    writeConversation("conv-c", {
      meta: { title: "C", createdAt: AT_LATE },
      transcript: [prompt("hi", AT_LATE, 1)],
    });

    const recentRunsPage = await loadRecentRunsPage();

    const first = recentRunsPage({ limit: 2 });
    expect(first.runs.map((row) => row.conversationId)).toEqual([
      "conv-c",
      "conv-b",
    ]);
    expect(first.nextCursor).toBe(`${AT}|conv-b`);

    const second = recentRunsPage({ limit: 2, cursor: first.nextCursor! });
    expect(second.runs.map((row) => row.conversationId)).toEqual(["conv-a"]);
    expect(second.nextCursor).toBeNull();

    const ids = [...first.runs, ...second.runs].map((row) => row.conversationId);
    expect(ids).toEqual(["conv-c", "conv-b", "conv-a"]);
  });

  it("pages conversations that share a createdAt by conversationId descending", async () => {
    writeConversation("conv-a", {
      meta: { title: "A", createdAt: AT },
      transcript: [prompt("hi", AT, 1)],
    });
    writeConversation("conv-z", {
      meta: { title: "Z", createdAt: AT },
      transcript: [prompt("hi", AT, 1)],
    });

    const recentRunsPage = await loadRecentRunsPage();

    const first = recentRunsPage({ limit: 1 });
    expect(first.runs.map((row) => row.conversationId)).toEqual(["conv-z"]);
    expect(first.nextCursor).toBe(`${AT}|conv-z`);

    const second = recentRunsPage({ limit: 1, cursor: first.nextCursor! });
    expect(second.runs.map((row) => row.conversationId)).toEqual(["conv-a"]);
    expect(second.nextCursor).toBeNull();
  });

  it("rejects a malformed cursor", async () => {
    const recentRunsPage = await loadRecentRunsPage();
    expect(() =>
      recentRunsPage({ limit: 1, cursor: "not-a-cursor" }),
    ).toThrow(/cursor must be createdAt\|conversationId/);
    try {
      recentRunsPage({ limit: 1, cursor: "not-a-cursor" });
    } catch (err) {
      expect(err).toMatchObject({
        code: "validation",
        message: "cursor must be createdAt|conversationId",
      });
    }
  });
});
