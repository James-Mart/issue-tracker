/** Tracker-managed worktree root — no per-Project override (SPEC § parallel worktree epic). */
export const WORKTREE_ROOT = "/root/issue-tracker-worktrees";

export const WORKTREE_BLOCKED_REASONS = ["parent-branch"] as const;

export type WorktreeBlockedReason = (typeof WORKTREE_BLOCKED_REASONS)[number];
