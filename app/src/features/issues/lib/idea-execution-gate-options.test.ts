import { describe, expect, it } from "vitest";
import { IDEA_EXECUTION_GATE_OPTIONS } from "./idea-execution-gate-options";

describe("IDEA_EXECUTION_GATE_OPTIONS", () => {
  it("documents the Planning-tab execution-gate effects", () => {
    expect(
      IDEA_EXECUTION_GATE_OPTIONS.find((option) => option.value === "auto")
        ?.effect,
    ).toBe("decides from the code-gate verdict: gated waits, start starts");
    expect(
      IDEA_EXECUTION_GATE_OPTIONS.find((option) => option.value === true)
        ?.effect,
    ).toBe("waits for a human start");
    expect(
      IDEA_EXECUTION_GATE_OPTIONS.find((option) => option.value === false)
        ?.effect,
    ).toBe("starts roots when decompose finishes");
  });
});