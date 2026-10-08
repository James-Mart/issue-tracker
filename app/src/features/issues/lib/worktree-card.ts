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
      locked: boolean;
    }
  | { kind: "active"; path: string; locked: boolean };

export const WORKTREE_PARENT_BRANCH_SUFFIX =
  "has no branch yet. Start its work loop before this Story can get a checkout.";

export const WORKTREE_SETUP_FAILED_COPY =
  "Project setup failed after checkout. Read the output below.";

/** Choose the card state from one Story's worktree checkout alone. */
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
      locked: worktree.locked,
    };
  }
  if (worktree.exists && worktree.path) {
    return { kind: "active", path: worktree.path, locked: worktree.locked };
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

export const WORKTREE_RETAINED_LOCKED_COPY =
  "This checkout outlived its Story — the worktree is locked outside the tracker.";

export const WORKTREE_LOCKED_REMOVE_COPY =
  "This worktree is locked outside the tracker. Unlock it (git worktree unlock) to remove it.";

export function worktreeRetainedCopy(
  uncommittedCount: number,
  atRiskCommitCount: number,
  locked = false,
): string {
  if (locked && uncommittedCount === 0 && atRiskCommitCount === 0) {
    return WORKTREE_RETAINED_LOCKED_COPY;
  }
  return `This checkout outlived its Story — ${worktreeNounCount(uncommittedCount, "uncommitted change", "uncommitted changes")}, ${worktreeNounCount(atRiskCommitCount, "at-risk commit", "at-risk commits")}.`;
}

export function worktreeRemoveConflictCopy(message: string): string {
  if (message.endsWith(": worktree is locked")) return WORKTREE_LOCKED_REMOVE_COPY;
  return message;
}

export function worktreeCardConflict(
  model: WorktreeCardModel,
  conflict: string | null,
): string | null {
  if (model.kind === "active" && model.locked) return WORKTREE_LOCKED_REMOVE_COPY;
  if (!conflict) return null;
  return worktreeRemoveConflictCopy(conflict);
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
