import { join } from "path";

/** Tracker-managed worktree root — no per-Project override (SPEC § parallel worktree epic). */
export const WORKTREE_ROOT = "/root/issue-tracker-worktrees";

export const WORKTREE_BLOCKED_REASONS = ["parent-branch"] as const;

export type WorktreeBlockedReason = (typeof WORKTREE_BLOCKED_REASONS)[number];

export function worktreePathFor(projectId: string, storyId: string): string {
  return join(WORKTREE_ROOT, projectId, storyId);
}

export function setupLogPathFor(projectId: string, storyId: string): string {
  return join(WORKTREE_ROOT, projectId, ".setup-logs", `${storyId}.log`);
}
