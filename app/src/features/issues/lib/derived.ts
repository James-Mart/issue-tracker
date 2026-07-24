import {
  EPIC_STATUSES,
  STORY_STATUSES,
  type StoryStatus,
  type TaskStatus,
  type EpicStatus,
  type SpecReviewStatus,
  type QaStatus,
  type RetroStatus,
  type IssueRecord,
  type DerivedState,
} from "@server/schemas";
import type { BadgeProps } from "@/components/ui/badge";

/** Sparkline stage visual state — idle ahead, current active, done behind/complete. */
export type StatusStageState = "done" | "current" | "idle";

export interface StatusStage {
  label: string;
  state: StatusStageState;
}

/** Task sparkline sequence — fixing is not a stage (dot stays on in-progress). */
const TASK_SPARKLINE_STATUSES = ["todo", "in-progress", "done"] as const;

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

export const SPEC_REVIEW_LABEL: Record<SpecReviewStatus, string> = {
  passed: "passed",
  failed: "failed",
};

export const SPEC_REVIEW_BADGE_VARIANT: Record<
  SpecReviewStatus,
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

/** True when work is actively in flight on this issue. */
export function isInFlight(
  issue: IssueRecord,
  state: DerivedState | undefined,
): boolean {
  if (
    issue.kind === "task" &&
    (issue.status === "in-progress" || issue.status === "fixing")
  ) {
    return true;
  }
  return (
    state?.storyStatus === "in-progress" ||
    state?.epicStatus === "in-progress"
  );
}

/** True when any issue in the set has active in-flight work. */
export function hasInFlightWork(
  issues: IssueRecord[],
  derived: Record<string, DerivedState>,
): boolean {
  return issues.some((issue) => isInFlight(issue, derived[issue.id]));
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

function stagesForIndex(
  labels: readonly string[],
  currentIndex: number,
  completed: boolean,
): StatusStage[] {
  return labels.map((label, i) => {
    if (completed || i < currentIndex) return { label, state: "done" as const };
    if (i === currentIndex) return { label, state: "current" as const };
    return { label, state: "idle" as const };
  });
}

/**
 * Sparkline stage list for an issue's primary status enum.
 * Task: todo → in-progress → done (fixing keeps the current dot on in-progress).
 * Story: not-started → in-progress → pr-open → merged.
 * Epic: todo → in-progress → done.
 * Other kinds: [].
 */
export function statusStages(
  issue: IssueRecord,
  state: DerivedState | undefined,
): StatusStage[] {
  if (issue.kind === "task") {
    const labels = TASK_SPARKLINE_STATUSES.map((s) => TASK_STATUS_LABEL[s]);
    const status =
      issue.status === "fixing" ? "in-progress" : issue.status;
    const currentIndex = TASK_SPARKLINE_STATUSES.indexOf(status);
    return stagesForIndex(labels, currentIndex, status === "done");
  }
  if (issue.kind === "story") {
    const labels = STORY_STATUSES.map((s) => STORY_STATUS_LABEL[s]);
    const status = state?.storyStatus ?? "not-started";
    const currentIndex = STORY_STATUSES.indexOf(status);
    return stagesForIndex(labels, currentIndex, status === "merged");
  }
  if (issue.kind === "epic") {
    const labels = EPIC_STATUSES.map((s) => EPIC_STATUS_LABEL[s]);
    const status = state?.epicStatus ?? "todo";
    const currentIndex = EPIC_STATUSES.indexOf(status);
    return stagesForIndex(labels, currentIndex, status === "done");
  }
  return [];
}
