import type { ModelSelection } from "@cursor/sdk";
import { assertAllowedAgentModelSlug } from "../agent-model-slugs.js";

declare const modelKeyBrand: unique symbol;

/**
 * A model name the app has checked: a pin in {@link MODEL_PINS} or an id the
 * model catalog lists. The SDK boundary accepts nothing else and translates
 * it with {@link toModelSelection}.
 */
export type ModelKey = string & { readonly [modelKeyBrand]: true };

/**
 * Every model the app names itself — role frontmatter pins and app constants —
 * mapped to the selection the SDK is sent.
 *
 * Everything but the base id travels in `params`, as `{ id, value }` pairs
 * whose values are strings. That is not a stylistic choice: the SDK builds its
 * request from `id` and `params` alone, so a parameter written as a top-level
 * key (`effort: "high"`) is dropped without a word and the role silently runs
 * at the backend's defaults. Nothing validates the pairs either — an
 * unrecognized parameter id or value is accepted and ignored just as quietly —
 * so the ids and values here must match what `Cursor.models.list()` advertises
 * for the model.
 */
const MODEL_PINS: Record<string, ModelSelection> = {
  "composer-2.5": { id: "composer-2.5" },
  "composer-2.5-fast": { id: "composer-2.5-fast" },
  "cursor-grok-4.7-high-fast": {
    id: "grok-4.7",
    params: [
      { id: "reasoning_effort", value: "high" },
      { id: "fast", value: "true" },
      // The catalog also advertises 500k and marks it default, but the
      // registry rejects that value. 256k is the context that runs.
      { id: "context", value: "256k" },
    ],
  },
  "cursor-grok-4.5-high-fast": {
    id: "grok-4.5",
    params: [
      { id: "effort", value: "high" },
      { id: "fast", value: "true" },
    ],
  },
  "claude-opus-5-5-thinking-high": {
    id: "claude-opus-5-5",
    params: [
      { id: "thinking", value: "true" },
      { id: "effort", value: "high" },
    ],
  },
};

export function isModelPin(value: string): value is ModelKey {
  return Object.hasOwn(MODEL_PINS, value);
}

/** Check a model name from storage or a request. Throws when it is neither a pin nor a catalog id. */
export function parseModelKey(value: string): ModelKey {
  if (isModelPin(value)) return value;
  assertAllowedAgentModelSlug(value);
  return value as ModelKey;
}

export function toModelSelection(key: ModelKey): ModelSelection {
  return MODEL_PINS[key] ?? { id: key };
}

/** Durable string form of the selection a key sends: base id plus its parameters. */
export function formatEffectiveModel(key: ModelKey): string {
  return JSON.stringify(toModelSelection(key));
}
