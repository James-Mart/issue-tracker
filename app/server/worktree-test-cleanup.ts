import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { WORKTREE_ROOT, worktreePathFor } from "./worktree-constants.js";

/** Drop a checkout directory. A failed git remove still deletes the directory, then prunes. */
export function forceRemoveCheckout(repo: string, path: string): void {
  if (!existsSync(path)) return;
  try {
    execFileSync("git", ["worktree", "remove", "--force", path], { cwd: repo });
  } catch {
    rmSync(path, { recursive: true, force: true });
    try {
      execFileSync("git", ["worktree", "prune"], { cwd: repo });
    } catch {
      // The directory is already gone; a failed prune leaves no checkout behind.
    }
  }
}

/** Drop the tracker checkout for one issue. */
export function forceRemoveWorktree(
  repo: string,
  projectId: string,
  issueId: string,
): void {
  if (!repo || !issueId) return;
  forceRemoveCheckout(repo, worktreePathFor(projectId, issueId));
}

const trackedWorktrees: { workspace: string; path: string }[] = [];

/** Remember a checkout so test teardown can drop it. */
export function trackWorktree(
  workspace: string,
  projectId: string,
  issueId: string,
): string {
  const path = worktreePathFor(projectId, issueId);
  trackedWorktrees.push({ workspace, path });
  return path;
}

/** Drop every checkout recorded by trackWorktree, then the project setup logs. */
export function removeTrackedWorktrees(): void {
  for (const { workspace, path } of trackedWorktrees.splice(0)) {
    forceRemoveCheckout(workspace, path);
  }
  rmSync(join(WORKTREE_ROOT, "p", ".setup-logs"), { recursive: true, force: true });
}
