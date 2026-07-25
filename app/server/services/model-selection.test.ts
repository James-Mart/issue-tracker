import { describe, expect, it } from "vitest";
import { resolveModelSelection } from "./model-selection.js";

describe("resolveModelSelection", () => {
  it("maps composer-2.5 to the base catalog id", () => {
    expect(resolveModelSelection("composer-2.5")).toEqual({
      id: "composer-2.5",
    });
  });

  it("maps cursor-grok-4.5-high-fast to grok-4.5 with effort and fast", () => {
    expect(resolveModelSelection("cursor-grok-4.5-high-fast")).toEqual({
      id: "grok-4.5",
      effort: "high",
      fast: true,
    });
  });

  it("maps claude-opus-5-thinking-high to claude-opus-5 with thinking and effort", () => {
    expect(resolveModelSelection("claude-opus-5-thinking-high")).toEqual({
      id: "claude-opus-5",
      thinking: true,
      effort: "high",
    });
  });

  it("throws for an unrecognized pin", () => {
    expect(() => resolveModelSelection("unknown-pin")).toThrow(
      "Unknown model pin: unknown-pin",
    );
  });
});
