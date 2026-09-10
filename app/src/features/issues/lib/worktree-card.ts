import type { DerivedWorktree } from "@server/schemas";

export type WorktreeCardKind =
  | "parent-branch"
  | "setup-failed"
  | "retained"
  | "active";

export type WorktreeCardModel =
  | { kind: "parent-branch" }
  | {
      kind: "setup-failed";
      path?: string;
      setupOutput?: string;
      setupLogPath?: string;
    }
  | {
      kind: "retained";
      path?: string;
      uncommittedCount: number;
      atRiskCommitCount: number;
    }
  | { kind: "active"; path: string };

export const WORKTREE_PARENT_BRANCH_SUFFIX =
  "has no branch yet. Start its work loop before this Story can get a checkout.";

export const WORKTREE_SETUP_FAILED_COPY =
  "Project setup failed after checkout. Read the output below.";

/** Choose the card state from `derived[storyId].worktree` alone. */
export function worktreeCardModel(
  worktree: DerivedWorktree | undefined,
): WorktreeCardModel | null {
  if (!worktree) return null;
  if (worktree.blockedReason === "parent-branch") {
    return { kind: "parent-branch" };
  }
  if (worktree.setupFailed) {
    return {
      kind: "setup-failed",
      path: worktree.path,
      setupOutput: worktree.setupOutput,
      setupLogPath: worktree.setupLogPath,
    };
  }
  if (worktree.retained) {
    return {
      kind: "retained",
      path: worktree.path,
      uncommittedCount: worktree.uncommittedCount,
      atRiskCommitCount: worktree.atRiskCommitCount,
    };
  }
  if (worktree.exists && worktree.path) {
    return { kind: "active", path: worktree.path };
  }
  return null;
}

export function worktreeNounCount(
  count: number,
  singular: string,
  plural: string,
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function worktreeRetainedCopy(
  uncommittedCount: number,
  atRiskCommitCount: number,
): string {
  return `This checkout outlived its Story — ${worktreeNounCount(uncommittedCount, "uncommitted change", "uncommitted changes")}, ${worktreeNounCount(atRiskCommitCount, "at-risk commit", "at-risk commits")}.`;
}

export const WORKTREE_REMOVE_DISABLED_REASON =
  "An implementing session is running on this Story. Stop the work loop before removing the checkout.";

export const WORKTREE_REMOVE_ACTIVE_CONFIRM =
  "This permanently deletes the isolated checkout. The main project tree is unaffected.";

export function worktreeRemoveRetainedConfirm(
  uncommittedCount: number,
  atRiskCommitCount: number,
): string {
  return `This checkout still has ${worktreeNounCount(uncommittedCount, "uncommitted change", "uncommitted changes")} and ${worktreeNounCount(atRiskCommitCount, "at-risk commit", "at-risk commits")}. Removing it permanently deletes the directory and that local work.`;
}
