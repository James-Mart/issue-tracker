import { describe, expect, it } from "vitest";
import { beatAccent } from "./components/run-sequence-shared";
import {
  beatStroke,
  collapsedIterationCount,
  failedLifelineId,
  displayedDurationMs,
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
  sections: [],
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
      sections: [],
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
      sections: [],
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
  it("formats a duration without a live suffix", () => {
    expect(formatSequenceDuration(45_000)).toBe("45s");
    expect(formatSequenceDuration(2 * 60_000 + 14_000)).toBe("2m 14s");
    expect(formatSequenceDuration(undefined)).toBeUndefined();
  });
});

describe("beatAccent", () => {
  it("does not paint a later return as failed while the run is in-flight", () => {
    const live: RunSequence = {
      condition: "in-flight",
      lifelines: completed.lifelines,
      sections: [],
      beats: [
        beat({
          from: "coordinator",
          to: "research",
          label: "spawn research",
          startedAt: "2026-08-28T12:03:00.000Z",
          kind: "spawn",
        }),
        beat({
          from: "planner",
          to: "coordinator",
          label: "planner returned",
          startedAt: "2026-08-28T12:04:00.000Z",
          durationMs: 12_000,
          kind: "return",
        }),
      ],
    };
    expect(beatAccent(live, 0)).toBe("live");
    expect(beatAccent(live, 1)).toBeUndefined();
  });
});

describe("displayedDurationMs", () => {
  it("prefers a live elapsed tick on the frontier", () => {
    const open = beat({
      from: "coordinator",
      to: "research",
      label: "spawn research",
      startedAt: "2026-08-28T12:03:00.000Z",
      kind: "spawn",
      liveElapsedMs: 12_000,
    });
    expect(displayedDurationMs(open, true)).toBe(12_000);
    expect(displayedDurationMs(open, false)).toBeUndefined();
  });
});
