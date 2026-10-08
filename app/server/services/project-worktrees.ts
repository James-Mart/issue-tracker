import type { ProjectWorktreesResponse } from "../schemas.js";
import { loadProjectWorktrees } from "./derive-worktree.js";

const inflight = new Map<string, Promise<ProjectWorktreesResponse>>();

/**
 * Worktree state for every Story in `projectId`. Concurrent callers share one
 * in-flight computation; the next call after it settles reads git again.
 */
export function projectWorktrees(
  projectId: string,
): Promise<ProjectWorktreesResponse> {
  const existing = inflight.get(projectId);
  if (existing) return existing;
  const pending = loadProjectWorktrees(projectId).finally(() => {
    if (inflight.get(projectId) === pending) inflight.delete(projectId);
  });
  inflight.set(projectId, pending);
  return pending;
}
