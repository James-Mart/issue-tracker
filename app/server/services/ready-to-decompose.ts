import type { DerivedState, Issue } from "../schemas.js";
import { listConversations } from "./conversations.js";
import { isRunLive } from "./run-live.js";

type OutlineIssue = Extract<Issue, { kind: "outline" }>;

/**
 * Structural half of Ready to decompose: concluded, in band, and no linked
 * root. A live decomposition run is cleared later by `list()`.
 */
export function outlineReadyToDecompose(
  outline: OutlineIssue,
  linkedRootOutlineIds: ReadonlySet<string>,
): boolean {
  if (!outline.concludedAt) return false;
  if (outline.outOfBand === true) return false;
  return !linkedRootOutlineIds.has(outline.id);
}

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
