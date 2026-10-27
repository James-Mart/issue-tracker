import { CHIP_UNSET } from "./fields.js";

export const APPEND_TARGET_MERGED_PLANNING_BLOCKED =
  "Planning is blocked until you clear the append target or choose an open Story. Post-landing follow-up belongs in a new root Story.";

export const APPEND_PLANNING_CANNOT_START_MERGED =
  "Append planning cannot start on a merged Story.";

export const APPEND_PLANNING_PARENT_NO_BRANCH =
  "The parent has no branch yet. Start its work loop or resolve its merge base before planning.";

export const APPEND_PLANNING_MERGE_BASE_UNRESOLVED =
  "The Story's merge base is unresolved.";

export const APPEND_PLANNING_WORKTREE_RESEARCH =
  "Research runs in the target Story's existing worktree and branch.";

export const APPEND_PLANNING_MERGE_BASE_RESEARCH =
  "Research reads the merge base on screen.";

export const APPEND_PLANNING_MERGE_BASE_HINT =
  "Read-only — the append target Story's effective merge base.";

export const APPEND_PLANNING_WORKTREE_HINT =
  "The Story worktree — research reads it, including uncommitted changes.";

export type AppendPlanningClosedReason =
  | "parent-has-no-branch"
  | "merge-base-unresolved";

export type AppendPlanningContext =
  | { status: "merged" }
  | { status: "open"; context: "worktree"; mergeBase?: string }
  | { status: "open"; context: "merge-base"; mergeBase: string }
  | { status: "closed"; reason: AppendPlanningClosedReason };

function refIfSet(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Story fields plus the two facts each caller already knows. */
export function appendPlanningContextForStory(
  story: { merged: boolean; stackedOn?: string },
  mergeBase: string | undefined,
  worktreeExists: boolean,
): AppendPlanningContext {
  return resolveAppendPlanningContext({
    merged: story.merged,
    worktreeExists,
    mergeBase,
    stackedOn: story.stackedOn,
  });
}

/**
 * Context an append Idea plans against. Merged wins, then an on-disk
 * worktree, then the Story's effective merge base. Otherwise planning is closed.
 */
export function resolveAppendPlanningContext(input: {
  merged: boolean;
  worktreeExists: boolean;
  mergeBase: string | undefined;
  stackedOn: string | undefined;
}): AppendPlanningContext {
  if (input.merged) return { status: "merged" };
  const mergeBase = refIfSet(input.mergeBase);
  if (input.worktreeExists) {
    return {
      status: "open",
      context: "worktree",
      ...(mergeBase ? { mergeBase } : {}),
    };
  }
  if (mergeBase) {
    return { status: "open", context: "merge-base", mergeBase };
  }
  return {
    status: "closed",
    reason: refIfSet(input.stackedOn)
      ? "parent-has-no-branch"
      : "merge-base-unresolved",
  };
}

/** Sentence a closed or merged launch shows. Open planning returns none. */
export function appendPlanningRefusal(
  context: AppendPlanningContext,
): string | undefined {
  if (context.status === "merged") return APPEND_TARGET_MERGED_PLANNING_BLOCKED;
  if (context.status !== "closed") return undefined;
  return context.reason === "parent-has-no-branch"
    ? APPEND_PLANNING_PARENT_NO_BRANCH
    : APPEND_PLANNING_MERGE_BASE_UNRESOLVED;
}

/** Body sentence for where research reads. Merged planning has no research line. */
export function appendPlanningResearchSentence(
  context: AppendPlanningContext,
): string | undefined {
  if (context.status === "merged") return undefined;
  if (context.status === "open" && context.context === "worktree") {
    return APPEND_PLANNING_WORKTREE_RESEARCH;
  }
  return APPEND_PLANNING_MERGE_BASE_RESEARCH;
}

/** Hint under the static merge-base ref. */
export function appendPlanningMergeBaseHint(
  context: AppendPlanningContext,
): string {
  if (
    context.status === "open" &&
    context.context === "worktree" &&
    !context.mergeBase
  ) {
    return APPEND_PLANNING_WORKTREE_HINT;
  }
  return APPEND_PLANNING_MERGE_BASE_HINT;
}

/** Static ref text. Unresolved refs render the shared unset chip. */
export function appendPlanningMergeBaseLabel(
  context: AppendPlanningContext,
): string {
  if (context.status === "open" && context.mergeBase) return context.mergeBase;
  return CHIP_UNSET;
}
