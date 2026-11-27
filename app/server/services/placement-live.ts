import type { DerivedState } from "../schemas.js";
import { listConversations } from "./conversations.js";
import { isRunLive } from "./run-live.js";

/**
 * A live decomposer run counts as placement even when no per-root chain is
 * stored (the first decompose). Chain-based liveness is set in `derive()`.
 */
export function markPlacementLiveDuringDecomposer(
  derived: Record<string, DerivedState>,
): void {
  for (const meta of listConversations()) {
    if (meta.outlineRole !== "decomposer" || meta.issueId === undefined) continue;
    if (!isRunLive(meta.id)) continue;
    const state = derived[meta.issueId];
    if (state) state.placementLive = true;
  }
}
