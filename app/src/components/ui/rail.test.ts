import { describe, expect, it } from "vitest";
import { sparkSegState, workCursorFraction } from "./rail";
import type { RailNodeState } from "@/features/issues/lib/rail-state";

describe("sparkSegState", () => {
  it("marks the segment into the current dot as current", () => {
    expect(sparkSegState("done", "current")).toBe("current");
    expect(sparkSegState("idle", "current")).toBe("current");
  });

  it("marks segments between done dots as done", () => {
    expect(sparkSegState("done", "done")).toBe("done");
  });

  it("marks remaining segments as idle", () => {
    expect(sparkSegState("current", "idle")).toBe("idle");
    expect(sparkSegState("idle", "idle")).toBe("idle");
    expect(sparkSegState("done", "idle")).toBe("idle");
  });
});

describe("workCursorFraction", () => {
  it("returns the center fraction of the in-flight node", () => {
    const states: RailNodeState[] = [
      "merged",
      "merged",
      "in-flight",
      "ready",
      "blocked",
    ];
    expect(workCursorFraction(states)).toBeCloseTo(2.5 / 5);
  });

  it("targets the first in-flight node when several are present", () => {
    const states: RailNodeState[] = ["in-flight", "in-flight", "ready"];
    expect(workCursorFraction(states)).toBeCloseTo(0.5 / 3);
  });

  it("returns null when no node is in-flight", () => {
    const states: RailNodeState[] = ["merged", "ready", "blocked"];
    expect(workCursorFraction(states)).toBeNull();
  });

  it("returns null for an empty spine", () => {
    expect(workCursorFraction([])).toBeNull();
  });
});
