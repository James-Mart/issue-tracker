import { join } from "path";

/**
 * Tracker-managed worktree root — no per-Project override (SPEC § parallel worktree epic).
 * `ISSUE_TRACKER_WORKTREE_ROOT` relocates the whole root so test workers never
 * share checkouts with each other or with the real root.
 */
export const WORKTREE_ROOT =
  process.env.ISSUE_TRACKER_WORKTREE_ROOT || "/root/issue-tracker-worktrees";

export const WORKTREE_BLOCKED_REASONS = ["parent-branch"] as const;

export type WorktreeBlockedReason = (typeof WORKTREE_BLOCKED_REASONS)[number];

/** Checkout path for an issue with the worktree capability. */
export function worktreePathFor(projectId: string, issueId: string): string {
  return join(WORKTREE_ROOT, projectId, issueId);
}

/** Log for the Project setup command run in that checkout. */
export function setupLogPathFor(projectId: string, issueId: string): string {
  return join(WORKTREE_ROOT, projectId, ".setup-logs", `${issueId}.log`);
}
