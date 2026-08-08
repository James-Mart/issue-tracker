import { bySequence } from "@server/order";
import type { DerivedState, IssueRecord } from "@server/schemas";
import { isInFlight } from "./derived";
import { issueRailNodeState, type RailNodeState } from "./rail-state";

export type { RailNodeState };

type StoryRecord = Extract<IssueRecord, { kind: "story" }>;
type TaskRecord = Extract<IssueRecord, { kind: "task" }>;

/**
 * Map an Epic child Story onto a Rail port state via shared derived helpers.
 * When a Story's own task is in flight, surface in-flight even if derived
 * storyStatus has not advanced past not-started (no branchName yet).
 */
export function storyRailNodeState(
  story: StoryRecord,
  derived: DerivedState | undefined,
  issues?: readonly IssueRecord[],
): RailNodeState {
  const base = issueRailNodeState(story, derived);
  if (
    base === "merged" ||
    base === "blocked" ||
    base === "needs-attention"
  ) {
    return base;
  }
  if (issues) {
    const tasks = issues.filter(
      (issue): issue is TaskRecord =>
        issue.kind === "task" && issue.partOf === story.id,
    );
    if (tasks.some((task) => isInFlight(task, undefined))) return "in-flight";
  }
  return base;
}

/** Ordered Stories that belong to an Epic — the single-spine Rail nodes. */
export function epicStoriesForRail(
  epicId: string,
  issues: readonly IssueRecord[],
): StoryRecord[] {
  return issues
    .filter(
      (issue): issue is StoryRecord =>
        issue.kind === "story" && issue.partOf === epicId,
    )
    .sort(bySequence);
}
