import { hasAttention } from "@server/kind";
import type { DerivedState, IssueRecord } from "@server/schemas";
import { isInFlight, isIssueComplete } from "./derived";

/**
 * Single-item work state for Rail ports and row-level StateIcon.
 * Ready carries no hue; done lands as `merged` (green) whether the kind
 * says done or merged.
 */
export type RailNodeState =
  | "ready"
  | "in-flight"
  | "blocked"
  | "merged"
  | "needs-attention";

/**
 * Map an issue onto the shared state-icon / port vocabulary using derived
 * status helpers. Attention wins over blocked / in-flight so the warn hue
 * surfaces when a human must act; otherwise blocked → in-flight → merged → ready.
 */
export function issueRailNodeState(
  issue: IssueRecord,
  state: DerivedState | undefined,
): RailNodeState {
  if (hasAttention(issue) && issue.needsAttention) return "needs-attention";
  if (issue.kind === "idea" && state?.ideaStatus === "awaiting-direction") {
    return "needs-attention";
  }
  if (state?.blocked) return "blocked";
  if (isInFlight(issue, state)) return "in-flight";
  if (issue.kind === "story" && state?.storyStatus === "in-progress") {
    return "in-flight";
  }
  if (issue.kind === "epic" && state?.epicStatus === "in-progress") {
    return "in-flight";
  }
  if (issue.kind === "idea" && state?.ideaStatus === "planning") {
    return "in-flight";
  }
  if (isIssueComplete(issue, state)) return "merged";
  return "ready";
}
