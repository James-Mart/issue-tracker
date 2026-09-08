import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AT,
  AT_CHILD,
  AT_EARLY,
  AT_END,
  AT_LATE,
  AT_ROUND1_END,
  AT_ROUND2_END,
  AT_ROUND3_END,
  delegation,
  loadRunSequence,
  prompt,
  setupRunSequenceTest,
  teardownRunSequenceTest,
  toolCall,
  writeConversation,
  writeRunLiveMarker,
} from "./run-sequence.fixtures.js";

beforeEach(() => {
  setupRunSequenceTest();
});

afterEach(() => {
  teardownRunSequenceTest();
});

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
});
