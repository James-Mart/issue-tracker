import { describe, expect, it } from "vitest";
import { inFlightIndex } from "./rail";
import type { RailNodeState } from "@/features/issues/lib/rail-state";

describe("inFlightIndex", () => {
  it("returns the index of the in-flight node", () => {
    const states: RailNodeState[] = [
      "merged",
      "merged",
      "in-flight",
      "ready",
      "blocked",
    ];
    expect(inFlightIndex(states)).toBe(2);
  });

  it("targets the first in-flight node when several are present", () => {
    const states: RailNodeState[] = ["in-flight", "in-flight", "ready"];
    expect(inFlightIndex(states)).toBe(0);
  });

  it("returns null when no node is in-flight", () => {
    const states: RailNodeState[] = ["merged", "ready", "blocked"];
    expect(inFlightIndex(states)).toBeNull();
  });

  it("returns null for an empty spine", () => {
    expect(inFlightIndex([])).toBeNull();
  });
});
