import { describe, expect, it } from "vitest";
import {
  formatEffectiveModel,
  resolveModelSelection,
} from "./model-selection.js";

describe("resolveModelSelection", () => {
  it("maps composer-2.5 to the base catalog id", () => {
    expect(resolveModelSelection("composer-2.5")).toEqual({
      id: "composer-2.5",
    });
  });

  it("maps cursor-grok-4.5-high-fast to grok-4.5 with effort and fast", () => {
    expect(resolveModelSelection("cursor-grok-4.5-high-fast")).toEqual({
      id: "grok-4.5",
      params: [
        { id: "effort", value: "high" },
        { id: "fast", value: "true" },
      ],
    });
  });

  it("maps claude-opus-5-thinking-high to claude-opus-5 with thinking and effort", () => {
    expect(resolveModelSelection("claude-opus-5-thinking-high")).toEqual({
      id: "claude-opus-5",
      params: [
        { id: "thinking", value: "true" },
        { id: "effort", value: "high" },
      ],
    });
  });

  // The SDK reads `id` and `params` and nothing else, so a parameter promoted
  // to a top-level key is dropped in silence and the pin runs at the backend's
  // defaults. Every pin previously did exactly that.
  it("carries parameters in params rather than as top-level keys", () => {
    for (const pin of [
      "composer-2.5",
      "cursor-grok-4.5-high-fast",
      "claude-opus-5-thinking-high",
    ]) {
      const selection = resolveModelSelection(pin);
      expect(Object.keys(selection).sort()).toEqual(
        selection.params ? ["id", "params"] : ["id"],
      );
      for (const param of selection.params ?? []) {
        expect(typeof param.value).toBe("string");
      }
    }
  });

  it("throws for an unrecognized pin", () => {
    expect(() => resolveModelSelection("unknown-pin")).toThrow(
      "Unknown model pin: unknown-pin",
    );
  });
});

describe("formatEffectiveModel", () => {
  it("serializes the base id plus parameters", () => {
    expect(
      formatEffectiveModel(
        resolveModelSelection("cursor-grok-4.5-high-fast"),
      ),
    ).toBe(
      '{"id":"grok-4.5","params":[{"id":"effort","value":"high"},{"id":"fast","value":"true"}]}',
    );
  });
});
