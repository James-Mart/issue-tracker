import type { Issue } from "../schemas.js";

export interface Repoint {
  id: string;
  // The deleted branch's own fork point that this branch inherits; absent means
  // it now forks the Epic base (`main`).
  to?: string;
}

export interface Unblock {
  id: string;
  // The Epic's `blockedBy` with every deleted id removed.
  blockedBy: string[];
}

export interface DeletionPlan {
  // The target plus everything transitively `partOf` it (the containment closure).
  deleteIds: string[];
  // Surviving branches whose `stackedOn` pointed into the delete set, spliced to
  // the deleted branch's own fork point.
  repoint: Repoint[];
  // Surviving Epics whose `blockedBy` had entries in the delete set removed.
  unblock: Unblock[];
}

// The outcome `remove()` returns once the plan has been applied.
export interface DeletionResult {
  deleted: string[];
  repointed: Repoint[];
  unblocked: Unblock[];
}

// Pure, filesystem-free planner for deleting an issue. It computes the full set
// of issues to remove (target + transitive `partOf` descendants) and how every
// surviving foreign reference into that set resolves:
//   - Branch `stackedOn` (always within one Epic): spliced to the deleted
//     branch's own fork point, walking up until a surviving branch (or
//     `undefined` = `main`).
//   - Epic `blockedBy` (the only cross-container edge): the deleted ids are
//     dropped, no inheritance.
// `partOf` never needs repair: anything that points into the delete set via
// `partOf` is itself contained and therefore also deleted.
export function planDeletion(issues: Issue[], id: string): DeletionPlan {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));

  const childrenOf = new Map<string, string[]>();
  for (const issue of issues) {
    if (issue.kind === "project") continue;
    const bucket = childrenOf.get(issue.partOf) ?? [];
    bucket.push(issue.id);
    childrenOf.set(issue.partOf, bucket);
  }

  const deleteSet = new Set<string>();
  const queue = byId.has(id) ? [id] : [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (deleteSet.has(current)) continue;
    deleteSet.add(current);
    for (const child of childrenOf.get(current) ?? []) queue.push(child);
  }

  // Follow `stackedOn` up from a deleted branch until a surviving branch is
  // found (the spliced fork point) or the chain ends (forks `main`).
  const survivingForkPoint = (deletedBranchId: string): string | undefined => {
    let cursor: string | undefined = deletedBranchId;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const branch = byId.get(cursor);
      const next = branch?.kind === "story" ? branch.stackedOn : undefined;
      if (!next) return undefined;
      if (!deleteSet.has(next)) return next;
      cursor = next;
    }
    return undefined;
  };

  const repoint: Repoint[] = [];
  const unblock: Unblock[] = [];
  for (const issue of issues) {
    if (deleteSet.has(issue.id)) continue;
    // Branch `stackedOn` splices within its Epic.
    if (issue.kind === "story" && issue.stackedOn && deleteSet.has(issue.stackedOn)) {
      repoint.push({ id: issue.id, to: survivingForkPoint(issue.stackedOn) });
    }
    // Epic `blockedBy` is the only cross-container edge; drop deleted ids.
    // Default at the access site so the pure planner tolerates in-memory epics
    // that were never parsed (fixtures may omit `blockedBy`).
    if (issue.kind === "epic" && (issue.blockedBy ?? []).some((dep) => deleteSet.has(dep))) {
      unblock.push({
        id: issue.id,
        blockedBy: (issue.blockedBy ?? []).filter((dep) => !deleteSet.has(dep)),
      });
    }
  }

  return { deleteIds: [...deleteSet], repoint, unblock };
}
