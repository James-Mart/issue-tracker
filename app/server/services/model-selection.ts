import type { ModelSelection } from "@cursor/sdk";

/** Map a role's frontmatter model pin to the selection the app sends the SDK. */
export function resolveModelSelection(pin: string): ModelSelection {
  switch (pin) {
    case "composer-2.5":
      return { id: "composer-2.5" };
    case "cursor-grok-4.5-high-fast":
      return { id: "grok-4.5", effort: "high", fast: true } as ModelSelection;
    case "claude-opus-5-thinking-high":
      return {
        id: "claude-opus-5",
        thinking: true,
        effort: "high",
      } as ModelSelection;
    default:
      throw new Error(`Unknown model pin: ${pin}`);
  }
}

/** Durable string form of a selection: base id plus its parameters. */
export function formatEffectiveModel(selection: ModelSelection): string {
  return JSON.stringify(selection);
}
