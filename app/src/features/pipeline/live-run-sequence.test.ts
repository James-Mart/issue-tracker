import { describe, expect, it } from "vitest";
import type { ConversationStreamEvent } from "@server/schemas";
import {
  applyLiveFrame,
  applyLiveFrames,
  insertFrameBySeq,
} from "./live-run-sequence";
import { AT, AT_NESTED, inFlightSequence, sampleRun } from "./live-run-sequence.test-helpers";

const AT_END = "2026-08-28T12:00:20.000Z";

function delegationFrame(): ConversationStreamEvent {
  return {
    type: "delegation",
    run: sampleRun(),
    at: AT_NESTED,
    seq: 10,
  };
}

describe("applyLiveFrame", () => {
  it("closes a matching spawn and flips the run to completed from delegation_end", () => {
    const next = applyLiveFrame(inFlightSequence(), {
      type: "delegation_end",
      delegationId: "del-impl",
      parentCallId: "call-impl",
      status: "completed",
      endedAt: AT_END,
      at: AT_END,
      seq: 12,
    });
    expect(next.condition).toBe("completed");
    expect(next.beats).toHaveLength(1);
    expect(next.beats[0]).toMatchObject({
      durationMs: 20_000,
      cumulativeMs: 20_000,
      parentCallId: "call-impl",
    });
    expect(next.beats[0]).not.toHaveProperty("liveElapsedMs");
    expect(next.beats.some((beat) => beat.kind === "return")).toBe(false);
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
        at: AT_END,
        seq: 11,
      },
      delegationFrame(),
    ];
    let ordered: ConversationStreamEvent[] = [];
    for (const frame of frames) {
      ordered = insertFrameBySeq(ordered, frame).frames;
    }
    expect(ordered.map((frame) => frame.seq)).toEqual([10, 11]);
    const next = applyLiveFrames(inFlightSequence(), ordered);
    expect(next.beats.map((row) => row.label)).toEqual([
      "spawn implementor",
      "spawn validator",
    ]);
    expect(next.beats[1]).toMatchObject({
      durationMs: Date.parse(AT_END) - Date.parse(AT_NESTED),
      cumulativeMs: Date.parse(AT_END) - Date.parse(AT),
    });
    expect(next.condition).toBe("in-flight");
  });

  it("skips a duplicate seq", () => {
    const first = delegationFrame();
    const inserted = insertFrameBySeq([first], { ...first, at: AT_END });
    expect(inserted.changed).toBe(false);
    expect(inserted.frames).toHaveLength(1);
  });
});
