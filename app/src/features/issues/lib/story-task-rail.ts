import { bySequence } from "@server/order";
import type { IssueRecord } from "@server/schemas";
import { isInFlight } from "./derived";
import type { RailNodeState } from "./rail-state";

export type { RailNodeState };

type TaskRecord = Extract<IssueRecord, { kind: "task" }>;

/**
 * Map a Story's task onto a Rail port state.
 * In-flight delegates to `isInFlight`; done reads as landed (`merged`);
 * everything else ready. The head of `commits` is label-only (see TaskRailLabel), not
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

/** Earliest appended Task by sequence order, or null when none are appended. */
export function firstAppendedTaskId(
  tasks: readonly TaskRecord[],
): string | null {
  return tasks.find((task) => task.appended === true)?.id ?? null;
}

/** Ordered Tasks an append Idea produced — the generated-issues rail nodes. */
export function ideaAppendedTasksForRail(
  ideaId: string,
  issues: readonly IssueRecord[],
): TaskRecord[] {
  return issues
    .filter(
      (issue): issue is TaskRecord =>
        issue.kind === "task" && issue.sourceIdea === ideaId,
    )
    .sort(bySequence);
}
