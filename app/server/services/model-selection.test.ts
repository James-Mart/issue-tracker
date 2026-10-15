import { describe, expect, it } from "vitest";
import { parseModelKey, toModelSelection } from "./model-selection.js";

describe("toModelSelection", () => {
  // The SDK reads `id` and `params` and nothing else, so a parameter promoted
  // to a top-level key is dropped in silence and the pin runs at the backend's
  // defaults. Every pin previously did exactly that.
  it("carries parameters in params rather than as top-level keys", () => {
    for (const pin of [
      "composer-2.5",
      "cursor-grok-4.7-high-fast",
      "cursor-grok-4.5-high-fast",
      "claude-opus-5-5-thinking-high",
    ]) {
      const selection = toModelSelection(parseModelKey(pin));
      expect(Object.keys(selection).sort()).toEqual(
        selection.params ? ["id", "params"] : ["id"],
      );
      for (const param of selection.params ?? []) {
        expect(typeof param.value).toBe("string");
      }
    }
  });
});
