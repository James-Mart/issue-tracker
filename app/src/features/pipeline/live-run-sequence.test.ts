import { describe, expect, it } from "vitest";
import type { AgentRun, ConversationStreamEvent } from "@server/schemas";
import {
  applyLiveFrame,
  applyLiveFrames,
  insertFrameBySeq,
} from "./live-run-sequence";
import type { RunSequence, RunSequenceSection, SequenceBeat } from "./run-sequence";

const AT = "2026-08-28T12:00:00.000Z";
const AT_MID = "2026-08-28T12:00:08.000Z";
const AT_NESTED = "2026-08-28T12:00:12.000Z";
const AT_END = "2026-08-28T12:00:20.000Z";

function beat(partial: SequenceBeat): SequenceBeat {
  return partial;
}

function inFlight(partial: Partial<RunSequence> = {}): RunSequence {
  return {
    condition: "in-flight",
    lifelines: [
      { id: "coordinator", label: "implementing", kind: "coordinator" },
      { id: "implementor", label: "implementor", kind: "role" },
    ],
    sections: [],
    beats: [
      beat({
        from: "coordinator",
        to: "implementor",
        label: "spawn implementor",
        startedAt: AT,
        kind: "spawn",
        parentCallId: "call-impl",
      }),
    ],
    ...partial,
  };
}

function sampleRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    delegationId: "del-qa",
    agentId: "agent-qa",
    role: "validator",
    model: "composer-2.5",
    issueId: "run-live-updates",
    parentCallId: "call-qa",
    conversationId: "conv-live",
    startedAt: AT_NESTED,
    status: "running",
    isResume: false,
    ...overrides,
  };
}

function delegationFrame(
  overrides: Partial<AgentRun> = {},
  seq = 10,
  at = AT_NESTED,
): ConversationStreamEvent {
  return {
    type: "delegation",
    run: sampleRun(overrides),
    at,
    seq,
  };
}

describe("applyLiveFrame", () => {
  it("appends a spawn beat for a nested delegation", () => {
    const next = applyLiveFrame(inFlight(), delegationFrame());
    expect(next.condition).toBe("in-flight");
    expect(next.lifelines.map((line) => line.id)).toEqual([
      "coordinator",
      "implementor",
      "validator",
    ]);
    expect(next.beats.map((row) => row.label)).toEqual([
      "spawn implementor",
      "spawn validator",
    ]);
    expect(next.beats[1]).toMatchObject({
      from: "implementor",
      to: "validator",
      kind: "spawn",
      parentCallId: "call-qa",
      seq: 10,
    });
    expect(next.beats[1]).not.toHaveProperty("durationMs");
  });

  it("inserts an earlier nested spawn ahead of a later beat", () => {
    const seeded = inFlight({
      beats: [
        beat({
          from: "coordinator",
          to: "implementor",
          label: "spawn implementor",
          startedAt: AT,
          kind: "spawn",
          parentCallId: "call-impl",
        }),
        beat({
          from: "human",
          to: "coordinator",
          label: "human replied",
          startedAt: AT_END,
          kind: "human-turn",
        }),
      ],
    });
    const next = applyLiveFrame(
      seeded,
      delegationFrame({ startedAt: AT_NESTED }, 4, AT_NESTED),
    );
    expect(next.beats.map((row) => row.label)).toEqual([
      "spawn implementor",
      "spawn validator",
      "human replied",
    ]);
  });

  it("does not append a delegation already present by parentCallId", () => {
    const next = applyLiveFrame(
      inFlight(),
      delegationFrame({ parentCallId: "call-impl", role: "implementor" }),
    );
    expect(next.beats).toHaveLength(1);
  });

  it("closes a matching spawn and flips the run to completed from delegation_end", () => {
    const next = applyLiveFrame(inFlight(), {
      type: "delegation_end",
      delegationId: "del-impl",
      parentCallId: "call-impl",
      status: "completed",
      endedAt: AT_END,
      seq: 12,
    });
    expect(next.condition).toBe("completed");
    expect(next.beats[0]).toMatchObject({
      durationMs: 20_000,
      parentCallId: "call-impl",
    });
    expect(next.beats[0]).not.toHaveProperty("liveElapsedMs");
    expect(next.beats[1]).toMatchObject({
      kind: "return",
      from: "implementor",
      to: "coordinator",
      label: "implementor returned",
      durationMs: 20_000,
    });
  });

  it("marks the run failed when delegation_end errors", () => {
    const next = applyLiveFrame(inFlight(), {
      type: "delegation_end",
      delegationId: "del-impl",
      parentCallId: "call-impl",
      status: "error",
      endedAt: AT_END,
      seq: 12,
    });
    expect(next.condition).toBe("failed");
    expect(next.beats[1]).toMatchObject({
      kind: "return",
      label: "implementor failed",
    });
    expect(next).not.toHaveProperty("recoveredErrors");
  });

  it("derives completed with recoveredErrors when an early failure is followed by later success", () => {
    let seq = applyLiveFrame(inFlight(), {
      type: "delegation_end",
      delegationId: "del-impl",
      parentCallId: "call-impl",
      status: "error",
      endedAt: AT_MID,
      seq: 5,
    });
    expect(seq.condition).toBe("failed");
    seq = applyLiveFrame(
      seq,
      delegationFrame(
        { role: "validator", parentCallId: "call-val", startedAt: AT_NESTED },
        6,
      ),
    );
    expect(seq.condition).toBe("in-flight");
    seq = applyLiveFrame(seq, {
      type: "delegation_end",
      delegationId: "del-val",
      parentCallId: "call-val",
      status: "completed",
      endedAt: AT_END,
      seq: 7,
    });
    expect(seq.condition).toBe("completed");
    expect(seq.recoveredErrors).toBe(1);
  });

  it("does not treat an indeterminate open spawn as in-flight", () => {
    const seq = inFlight({
      beats: [
        beat({
          from: "coordinator",
          to: "research",
          label: "spawn research",
          startedAt: AT,
          kind: "spawn",
          parentCallId: "call-research",
          indeterminate: true,
        }),
        beat({
          from: "coordinator",
          to: "implementor",
          label: "spawn implementor",
          startedAt: AT,
          kind: "spawn",
          parentCallId: "call-impl",
        }),
      ],
    });
    const next = applyLiveFrame(seq, {
      type: "delegation_end",
      delegationId: "del-impl",
      parentCallId: "call-impl",
      status: "completed",
      endedAt: AT_END,
      seq: 12,
    });
    expect(next.condition).toBe("completed");
  });

  it("ignores a terminal tool_call", () => {
    const seed = inFlight();
    const next = applyLiveFrame(seed, {
      type: "tool_call",
      callId: "call-impl",
      name: "Task",
      status: "completed",
      at: AT_END,
      seq: 12,
    });
    expect(next).toBe(seed);
  });

  it("ignores a non-terminal tool_call", () => {
    const seed = inFlight();
    const next = applyLiveFrame(seed, {
      type: "tool_call",
      callId: "call-impl",
      name: "Task",
      status: "running",
      at: AT_MID,
      seq: 5,
    });
    expect(next).toBe(seed);
  });

  it("extends the matching issue section to cover a live-appended beat", () => {
    const sections: RunSequenceSection[] = [
      {
        issueId: "pipeline-fixes",
        kind: "epic",
        title: "Pipeline fixes",
        beatStart: 0,
        beatEnd: 0,
        children: [
          {
            issueId: "run-live-updates",
            kind: "task",
            title: "Keep live-appended beats visible",
            beatStart: 0,
            beatEnd: 0,
            children: [],
          },
        ],
      },
    ];
    const next = applyLiveFrame(inFlight({ sections }), delegationFrame());
    expect(next.beats).toHaveLength(2);
    expect(next.beats[1]).toMatchObject({
      label: "spawn validator",
      parentCallId: "call-qa",
    });
    expect(next.sections).toEqual([
      {
        issueId: "pipeline-fixes",
        kind: "epic",
        title: "Pipeline fixes",
        beatStart: 0,
        beatEnd: 1,
        children: [
          {
            issueId: "run-live-updates",
            kind: "task",
            title: "Keep live-appended beats visible",
            beatStart: 0,
            beatEnd: 1,
            children: [],
          },
        ],
      },
    ]);
  });

  it("extends the last open section when the appended beat has no matching issue", () => {
    const next = applyLiveFrame(
      inFlight({
        sections: [
          {
            issueId: "other-task",
            kind: "task",
            title: "Other task",
            beatStart: 0,
            beatEnd: 0,
            children: [],
          },
        ],
      }),
      delegationFrame(),
    );
    expect(next.sections).toEqual([
      {
        issueId: "other-task",
        kind: "task",
        title: "Other task",
        beatStart: 0,
        beatEnd: 1,
        children: [],
      },
    ]);
  });

  it("ticks the frontier elapsed time without closing the beat", () => {
    const next = applyLiveFrame(inFlight(), {
      type: "subagent_update",
      parentCallId: "call-impl",
      step: { kind: "text", text: "still going" },
      at: AT_MID,
      seq: 7,
    });
    expect(next.condition).toBe("in-flight");
    expect(next.beats).toHaveLength(1);
    expect(next.beats[0]).toMatchObject({
      liveElapsedMs: 8_000,
    });
    expect(next.beats[0]).not.toHaveProperty("durationMs");
  });
});

describe("insertFrameBySeq / applyLiveFrames", () => {
  it("applies out-of-order frames in seq order", () => {
    const frames = [
      {
        type: "delegation_end" as const,
        delegationId: "del-qa",
        parentCallId: "call-qa",
        status: "completed" as const,
        endedAt: AT_END,
        seq: 11,
      },
      delegationFrame(),
    ];
    let ordered: ConversationStreamEvent[] = [];
    for (const frame of frames) {
      ordered = insertFrameBySeq(ordered, frame);
    }
    expect(ordered.map((frame) => frame.seq)).toEqual([10, 11]);
    const next = applyLiveFrames(inFlight(), ordered);
    expect(next.beats.map((row) => row.label)).toEqual([
      "spawn implementor",
      "spawn validator",
      "validator returned",
    ]);
    expect(next.condition).toBe("in-flight");
  });

  it("skips a duplicate seq", () => {
    const first = delegationFrame();
    const frames = insertFrameBySeq([first], { ...first, at: AT_END });
    expect(frames).toHaveLength(1);
  });
});
