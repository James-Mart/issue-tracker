import type { DerivedState } from "../schemas.js";
import { listConversations } from "./conversations.js";
import { isRunLive } from "./run-live.js";

/** Clear Ready to decompose while a decomposition session on the outline has a live run. */
export function clearReadyDuringLiveDecomposition(
  derived: Record<string, DerivedState>,
): void {
  const live = new Set<string>();
  for (const meta of listConversations()) {
    if (
      meta.issueId !== undefined &&
      meta.channel === "decomposition" &&
      isRunLive(meta.id)
    ) {
      live.add(meta.issueId);
    }
  }
  for (const id of live) {
    const state = derived[id];
    if (state?.readyToDecompose) state.readyToDecompose = false;
  }
}
