import { bySequence } from "@server/order";
import type { IssueRecord } from "@server/schemas";
import { isInFlight } from "./derived";
import type { RailNodeState } from "./rail-state";

export type { RailNodeState };

type TaskRecord = Extract<IssueRecord, { kind: "task" }>;

/**
 * Map a Story's task onto a Rail port state.
 * In-flight delegates to `isInFlight`; done reads as landed (`merged`);
 * everything else ready. `commitSha` is label-only (see TaskRailLabel), not
 * a gate on merged. Story-task spines have no blockedBy edges.
 */
export function taskRailNodeState(task: TaskRecord): RailNodeState {
  if (isInFlight(task, undefined)) return "in-flight";
  if (task.status === "done") return "merged";
  return "ready";
}

/** Ordered tasks that belong to a Story — the single-spine Rail nodes. */
export function storyTasksForRail(
  storyId: string,
  issues: readonly IssueRecord[],
): TaskRecord[] {
  return issues
    .filter(
      (issue): issue is TaskRecord =>
        issue.kind === "task" && issue.partOf === storyId,
    )
    .sort(bySequence);
}
