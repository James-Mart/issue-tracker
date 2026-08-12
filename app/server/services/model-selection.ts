import type { ModelSelection } from "@cursor/sdk";

/**
 * Map a role's frontmatter model pin to the selection the app sends the SDK.
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
export function resolveModelSelection(pin: string): ModelSelection {
  switch (pin) {
    case "composer-2.5":
      return { id: "composer-2.5" };
    case "cursor-grok-4.6-high-fast":
      return {
        id: "grok-4.6",
        params: [
          { id: "effort", value: "high" },
          { id: "fast", value: "true" },
        ],
      };
    case "cursor-grok-4.5-high-fast":
      return {
        id: "grok-4.5",
        params: [
          { id: "effort", value: "high" },
          { id: "fast", value: "true" },
        ],
      };
    case "claude-opus-5-thinking-high":
      return {
        id: "claude-opus-5",
        params: [
          { id: "thinking", value: "true" },
          { id: "effort", value: "high" },
        ],
      };
    default:
      throw new Error(`Unknown model pin: ${pin}`);
  }
}

/**
 * Map stored conversation meta.model to the selection the SDK expects.
 *
 * Compound pins go through {@link resolveModelSelection}; plain catalog ids
 * pass through as `{ id }` so backend defaults apply.
 */
export function resolveConversationModel(stored: string): ModelSelection {
  try {
    return resolveModelSelection(stored);
  } catch {
    return { id: stored };
  }
}

/** Durable string form of a selection: base id plus its parameters. */
export function formatEffectiveModel(selection: ModelSelection): string {
  return JSON.stringify(selection);
}
