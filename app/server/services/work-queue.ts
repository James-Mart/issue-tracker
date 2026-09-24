import type { Issue, IssuePatch } from "../schemas.js";
import { derive } from "./derive.js";

function workRootOf(
  planRootId: string,
  byId: Map<string, Issue>,
): Extract<Issue, { kind: "epic" | "story" }> | undefined {
  const issue = byId.get(planRootId);
  if (!issue) return undefined;
  if (issue.kind === "epic") return issue;
  if (issue.kind !== "story") return undefined;
  const parent = byId.get(issue.partOf);
  if (parent?.kind === "epic") return parent;
  if (parent?.kind === "project") return issue;
  return undefined;
}

/**
 * Stamp `workQueuedAt` on each plan root's work root when an auto-planned
 * Idea archives. Roots that already carry the stamp are left as they are.
 */
export function planWorkQueueStamps(
  existing: Issue,
  patch: IssuePatch,
  issues: Issue[],
  now: string,
): Issue[] {
  if (existing.kind !== "idea" || existing.archived) return [];
  if (patch.archived !== true) return [];
  if (!existing.stakeholder) return [];
  if (existing.executionGate === true) return [];

  const planRoots = derive(issues).byId[existing.id]?.planRoots ?? [];
  if (planRoots.length === 0) return [];

  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const stamped = new Map<string, Issue>();
  for (const rootId of planRoots) {
    const workRoot = workRootOf(rootId, byId);
    if (!workRoot || workRoot.workQueuedAt || stamped.has(workRoot.id)) {
      continue;
    }
    stamped.set(workRoot.id, {
      ...workRoot,
      workQueuedAt: now,
      updatedAt: now,
    });
  }
  return [...stamped.values()];
}
