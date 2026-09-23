import type { Issue } from "../schemas.js";
import { derive } from "./derive.js";
import { IssueError } from "./errors.js";
import { ancestorChain, subtreeIds } from "./subtree.js";

/** Derived mergeBase of `finisherId` before the merged write. */
export function landedBaseForMerge(
  finisherId: string,
  issues: Issue[],
): string | undefined {
  return derive(issues).byId[finisherId]?.mergeBase;
}

/**
 * Started, branched, unmerged sibling Stories in the finisher's Project that
 * could need `needsRebase` after the finisher lands — every filter
 * `staleSiblingIds` applies except the landed-base match.
 */
export function staleSiblingCandidates(
  issues: Issue[],
  finisherId: string,
): string[] {
  const prospective = issues.map((issue) =>
    issue.id === finisherId && issue.kind === "story"
      ? { ...issue, merged: true }
      : issue,
  );
  const { byId } = derive(prospective);
  const projectId = ancestorChain(finisherId, issues)[0]!.id;
  const inProject = subtreeIds(prospective, projectId);

  const candidates: string[] = [];
  for (const issue of prospective) {
    if (issue.kind !== "story") continue;
    if (issue.id === finisherId) continue;
    if (!inProject.has(issue.id)) continue;
    if (issue.merged) continue;
    if (!issue.branchName) continue;
    const state = byId[issue.id];
    if (!state?.storyStatus || state.storyStatus === "not-started") continue;
    candidates.push(issue.id);
  }
  return candidates;
}

/**
 * Stories that need `needsRebase` after `finisherId` lands on `landedBase`.
 * Matches finish-branch step 3 / SPEC § Project merge policy "Flag stale children".
 */
export function staleSiblingIds(
  issues: Issue[],
  finisherId: string,
  landedBase: string,
): string[] {
  const candidates = staleSiblingCandidates(issues, finisherId);
  if (candidates.length === 0) return [];

  const prospective = issues.map((issue) =>
    issue.id === finisherId && issue.kind === "story"
      ? { ...issue, merged: true }
      : issue,
  );
  const { byId } = derive(prospective);
  return candidates.filter((id) => byId[id]?.mergeBase === landedBase);
}

/** Resolve landed base and stale siblings for a Story merge write. */
export function mergeCascade(
  issues: Issue[],
  finisherId: string,
): { landedBase?: string; staleIds: string[] } {
  const candidates = staleSiblingCandidates(issues, finisherId);
  if (candidates.length === 0) {
    return { staleIds: [] };
  }

  const landedBase = landedBaseForMerge(finisherId, issues);
  if (landedBase === undefined) {
    throw new IssueError(
      "validation",
      `cannot record merge for "${finisherId}": landed base unresolved with stale sibling candidate(s): ${candidates.join(", ")}`,
    );
  }

  return {
    landedBase,
    staleIds: staleSiblingIds(issues, finisherId, landedBase),
  };
}
