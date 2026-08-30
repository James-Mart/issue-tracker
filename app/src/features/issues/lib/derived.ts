import {
  type StoryStatus,
  type TaskStatus,
  type EpicStatus,
  type ReviewStatus,
  type QaStatus,
  type RetroStatus,
  type IssueRecord,
  type DerivedState,
} from "@server/schemas";
import type { BadgeProps } from "@/components/ui/badge";

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "todo",
  "in-progress": "in progress",
  fixing: "fixing",
  done: "done",
};

export const TASK_STATUS_BADGE_VARIANT: Record<
  TaskStatus,
  NonNullable<BadgeProps["variant"]>
> = {
  todo: "todo",
  "in-progress": "inProgress",
  fixing: "current",
  done: "done",
};

export const QA_STATUS_LABEL: Record<QaStatus, string> = {
  reviewing: "reviewing",
  "changes-requested": "changes requested",
  passed: "passed",
};

export const QA_STATUS_BADGE_VARIANT: Record<
  QaStatus,
  NonNullable<BadgeProps["variant"]>
> = {
  reviewing: "inProgress",
  "changes-requested": "destructive",
  passed: "done",
};

export const STORY_STATUS_LABEL: Record<StoryStatus, string> = {
  "not-started": "not started",
  "in-progress": "in progress",
  "pr-open": "PR open",
  merged: "merged",
};

export const STORY_STATUS_BADGE_VARIANT: Record<
  StoryStatus,
  NonNullable<BadgeProps["variant"]>
> = {
  "not-started": "todo",
  "in-progress": "inProgress",
  "pr-open": "outline",
  merged: "done",
};

export const EPIC_STATUS_LABEL: Record<EpicStatus, string> = {
  todo: "todo",
  "in-progress": "in progress",
  done: "done",
};

export const EPIC_STATUS_BADGE_VARIANT: Record<
  EpicStatus,
  NonNullable<BadgeProps["variant"]>
> = {
  todo: "todo",
  "in-progress": "inProgress",
  done: "done",
};

export const REVIEW_LABEL: Record<ReviewStatus, string> = {
  passed: "passed",
  failed: "failed",
};

export const REVIEW_BADGE_VARIANT: Record<
  ReviewStatus,
  NonNullable<BadgeProps["variant"]>
> = {
  passed: "done",
  failed: "destructive",
};

export const RETRO_LABEL: Record<RetroStatus, string> = {
  "in-progress": "in progress",
  done: "done",
};

export const RETRO_BADGE_VARIANT: Record<
  RetroStatus,
  NonNullable<BadgeProps["variant"]>
> = {
  "in-progress": "inProgress",
  done: "done",
};

/** True when an agent is actively working this task (status in-progress or fixing). */
export function isInFlight(
  issue: IssueRecord,
  _state?: DerivedState | undefined,
): boolean {
  return (
    issue.kind === "task" &&
    (issue.status === "in-progress" || issue.status === "fixing")
  );
}

/** True when any issue in the set has active in-flight work. */
export function hasInFlightWork(
  issues: IssueRecord[],
  derived: Record<string, DerivedState>,
): boolean {
  return issues.some(
    (issue) =>
      derived[issue.id]?.liveRun === true ||
      isInFlight(issue, derived[issue.id]),
  );
}

/**
 * True when an issue is complete for progress/bucket purposes:
 * task done, story merged (derived or `merged` flag), epic done.
 */
export function isIssueComplete(
  issue: IssueRecord,
  state: DerivedState | undefined,
): boolean {
  if (issue.kind === "task") return issue.status === "done";
  if (issue.kind === "story") {
    return state?.storyStatus === "merged" || issue.merged === true;
  }
  if (issue.kind === "epic") return state?.epicStatus === "done";
  return false;
}

type TaskRecord = Extract<IssueRecord, { kind: "task" }>;

/** Leaf tasks under a Story or Epic; empty for other kinds. */
export function leafTasksOf(
  issue: IssueRecord,
  issues: IssueRecord[],
): TaskRecord[] {
  if (issue.kind === "story") {
    return issues.filter(
      (candidate): candidate is TaskRecord =>
        candidate.kind === "task" && candidate.partOf === issue.id,
    );
  }
  if (issue.kind === "epic") {
    const storyIds = new Set(
      issues
        .filter((candidate) => candidate.kind === "story" && candidate.partOf === issue.id)
        .map((candidate) => candidate.id),
    );
    return issues.filter(
      (candidate): candidate is TaskRecord =>
        candidate.kind === "task" && storyIds.has(candidate.partOf),
    );
  }
  return [];
}

/** Tabular leaf-task progress (`done/total`) for row count slots; undefined when none. */
export function leafTaskProgressCount(
  issue: IssueRecord,
  issues: IssueRecord[],
): string | undefined {
  const tasks = leafTasksOf(issue, issues);
  if (tasks.length === 0) return undefined;
  const done = tasks.filter((task) => task.status === "done").length;
  return `${done}/${tasks.length}`;
}
