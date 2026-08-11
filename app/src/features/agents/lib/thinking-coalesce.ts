import type { NestedStep, TranscriptEvent } from "@server/schemas";

/**
 * Shared Thinking coalesce rule for top-level transcript events and nested
 * steps: keep concatenating streaming thinking until a *visible* row
 * interrupts. Invisible noise must not start a new Thinking block.
 */

/** True when top-level `event` should split a Thinking stretch. */
export function isTopLevelThinkingInterrupt(event: TranscriptEvent): boolean {
  switch (event.type) {
    case "thinking":
    case "usage":
    case "subagent_update":
      return false;
    case "status":
      // Bare run-state status is omitted from the thread body.
      return Boolean(event.message);
    default:
      return true;
  }
}

/** True when nested `step` should split a Thinking stretch. */
export function isNestedThinkingInterrupt(step: NestedStep): boolean {
  switch (step.kind) {
    case "thinking":
    case "liveness":
      return false;
    default:
      return true;
  }
}

/** Empty / whitespace-only thinking must not become a row. */
export function isBlankThinkingText(text: string): boolean {
  return text.trim().length === 0;
}

/**
 * Index of the open Thinking item at the tip of `items`, looking past trailing
 * non-interrupt noise. `-1` when a visible interrupt is nearer than any
 * Thinking item (or the list has none).
 */
export function findOpenThinkingIndex<T>(
  items: readonly T[],
  isThinking: (item: T) => boolean,
  isInterrupt: (item: T) => boolean,
): number {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (isThinking(item)) return i;
    if (isInterrupt(item)) return -1;
  }
  return -1;
}
