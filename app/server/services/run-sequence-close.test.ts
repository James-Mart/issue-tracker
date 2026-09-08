import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AT,
  AT_END,
  AT_LATE,
  delegation,
  loadRunSequence,
  setupRunSequenceTest,
  teardownRunSequenceTest,
  subagentToolCall,
  toolCall,
  writeConversation,
} from "./run-sequence.fixtures.js";

beforeEach(() => {
  setupRunSequenceTest();
});

afterEach(() => {
  teardownRunSequenceTest();
});

describe("runSequence", () => {
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
});
