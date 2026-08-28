import { describe, expect, it } from "vitest";
import {
  beatStroke,
  collapsedIterationCount,
  failedLifelineId,
  formatSequenceDuration,
  frontierBeatIndex,
  isCollapsedBeat,
  lifelineTail,
  type RunSequence,
  type SequenceBeat,
  type SequenceLifeline,
} from "./run-sequence";

function lifeline(
  id: string,
  kind: SequenceLifeline["kind"] = "role",
): SequenceLifeline {
  return { id, label: id, kind };
}

function beat(partial: SequenceBeat): SequenceBeat {
  return partial;
}

const completed: RunSequence = {
  condition: "completed",
  lifelines: [
    lifeline("human", "human"),
    lifeline("coordinator", "coordinator"),
    lifeline("research"),
  ],
  beats: [
    beat({
      from: "coordinator",
      to: "research",
      label: "spawn research",
      startedAt: "2026-08-28T12:00:00.000Z",
      durationMs: 45_000,
      kind: "spawn",
    }),
    beat({
      from: "research",
      to: "coordinator",
      label: "research returned",
      startedAt: "2026-08-28T12:00:45.000Z",
      durationMs: 92_000,
      kind: "return",
    }),
    beat({
      from: "human",
      to: "coordinator",
      label: "human replied",
      startedAt: "2026-08-28T12:02:17.000Z",
      kind: "human-turn",
    }),
  ],
};

describe("beatStroke", () => {
  it("separates spawn, return, and human-turn by stroke, not by hue of condition", () => {
    expect(beatStroke("spawn")).toEqual({ color: "rail-lit", width: 1.5 });
    expect(beatStroke("return")).toEqual({
      color: "mut",
      width: 1.5,
      dash: "return",
    });
    const human = beatStroke("human-turn");
    expect(human.color).toBe("ink");
    expect(human.width).toBeGreaterThan(beatStroke("spawn").width);
    expect(human.dash).toBeUndefined();
  });
});

describe("collapsedIterationCount", () => {
  it("returns the turn count as its own datum", () => {
    const collapsed = beat({
      from: "coordinator",
      to: "polish",
      label: "spawn polish",
      startedAt: "2026-08-28T12:00:00.000Z",
      durationMs: 90_000,
      kind: "spawn",
      turns: [
        { label: "spawn polish", startedAt: "2026-08-28T12:00:00.000Z", durationMs: 28_000 },
        { label: "spawn polish", startedAt: "2026-08-28T12:00:28.000Z", durationMs: 30_000 },
        { label: "spawn polish", startedAt: "2026-08-28T12:00:58.000Z", durationMs: 32_000 },
      ],
    });
    expect(isCollapsedBeat(collapsed)).toBe(true);
    expect(collapsedIterationCount(collapsed)).toBe(3);
    expect(collapsedIterationCount(completed.beats[0]!)).toBeUndefined();
  });
});

describe("lifelineTail", () => {
  it("encodes each condition by shape", () => {
    expect(lifelineTail("completed")).toBe("extend");
    expect(lifelineTail("in-flight")).toBe("open-dash");
    expect(lifelineTail("failed")).toBe("stop");
  });
});

describe("failedLifelineId", () => {
  it("names the lifeline a failed return leaves", () => {
    const failed: RunSequence = {
      condition: "failed",
      lifelines: completed.lifelines,
      beats: [
        ...completed.beats.slice(0, 2),
        beat({
          from: "research",
          to: "coordinator",
          label: "research failed",
          startedAt: "2026-08-28T12:02:00.000Z",
          durationMs: 12_000,
          kind: "return",
        }),
      ],
    };
    expect(failedLifelineId(failed)).toBe("research");
  });
});

describe("frontierBeatIndex", () => {
  it("points at the open spawn of an in-flight run", () => {
    const live: RunSequence = {
      condition: "in-flight",
      lifelines: completed.lifelines,
      beats: [
        completed.beats[0]!,
        beat({
          from: "coordinator",
          to: "research",
          label: "spawn research",
          startedAt: "2026-08-28T12:03:00.000Z",
          kind: "spawn",
        }),
      ],
    };
    expect(frontierBeatIndex(live)).toBe(1);
    expect(frontierBeatIndex(completed)).toBeUndefined();
  });
});

describe("formatSequenceDuration", () => {
  it("keeps a frontier duration visually open", () => {
    expect(formatSequenceDuration(45_000, false)).toBe("45s");
    expect(formatSequenceDuration(45_000, true)).toBe("45s…");
    expect(formatSequenceDuration(undefined, true)).toBe("…");
    expect(formatSequenceDuration(undefined, false)).toBeUndefined();
  });
});
