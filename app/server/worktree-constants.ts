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

export function worktreePathFor(projectId: string, storyId: string): string {
  return join(WORKTREE_ROOT, projectId, storyId);
}

export function setupLogPathFor(projectId: string, storyId: string): string {
  return join(WORKTREE_ROOT, projectId, ".setup-logs", `${storyId}.log`);
}
