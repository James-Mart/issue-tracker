import { MERGE_POLICY_RANK } from "../fields.js";
import type { Issue, IssuePatch, MergePolicy } from "../schemas.js";
import { IssueError } from "./errors.js";
import { mergeIssue } from "./merge.js";

/** Parent whose effective policy is this node's ceiling (when ceilinged). */
export function mergePolicyParentId(issue: Issue): string | undefined {
  if (issue.kind === "epic") return issue.partOf;
  if (issue.kind === "story") return issue.stackedOn ?? issue.partOf;
  return undefined;
}

/**
 * Root-level Epic or Story with an explicit non-trunk merge-base override:
 * no ceiling (Epic ceiling-direction exception).
 */
export function isUnceilingedRoot(
  issue: Issue,
  byId: Map<string, Issue>,
): boolean {
  if (issue.kind === "epic") {
    const project = byId.get(issue.partOf);
    if (project?.kind !== "project") return false;
    const override = issue.mergeBaseOverride;
    return override !== undefined && override !== project.trunk;
  }
  if (issue.kind === "story") {
    if (issue.stackedOn) return false;
    const parent = byId.get(issue.partOf);
    if (parent?.kind !== "project") return false;
    const override = issue.mergeBaseOverride;
    return override !== undefined && override !== parent.trunk;
  }
  return false;
}

/** Effective merge policy: stored value, else parent's effective. */
export function effectiveMergePolicy(
  id: string,
  byId: Map<string, Issue>,
  cache: Map<string, MergePolicy> = new Map(),
  visiting: Set<string> = new Set(),
): MergePolicy {
  const cached = cache.get(id);
  if (cached !== undefined) return cached;
  if (visiting.has(id)) return "manual";

  const issue = byId.get(id);
  if (!issue) {
    cache.set(id, "manual");
    return "manual";
  }

  visiting.add(id);

  let policy: MergePolicy;
  if (issue.kind === "project") {
    policy = issue.mergePolicy;
  } else if (issue.kind === "epic") {
    policy =
      issue.mergePolicy !== undefined
        ? issue.mergePolicy
        : effectiveMergePolicy(issue.partOf, byId, cache, visiting);
  } else if (issue.kind === "story") {
    policy =
      issue.mergePolicy !== undefined
        ? issue.mergePolicy
        : effectiveMergePolicy(
            issue.stackedOn ?? issue.partOf,
            byId,
            cache,
            visiting,
          );
  } else {
    policy = "manual";
  }

  visiting.delete(id);
  cache.set(id, policy);
  return policy;
}

/** Parent effective policy, or `undefined` when the node has no ceiling. */
export function mergePolicyCeiling(
  issue: Issue,
  byId: Map<string, Issue>,
  cache: Map<string, MergePolicy> = new Map(),
): MergePolicy | undefined {
  if (issue.kind === "project") return undefined;
  if (isUnceilingedRoot(issue, byId)) return undefined;
  const parentId = mergePolicyParentId(issue);
  if (!parentId) return undefined;
  return effectiveMergePolicy(parentId, byId, cache);
}

function ceilingViolationMessage(
  issue: Issue,
  effective: MergePolicy,
  ceiling: MergePolicy,
): string {
  const parentId = mergePolicyParentId(issue);
  return (
    `mergePolicy "${effective}" exceeds ceiling "${ceiling}"` +
    (parentId ? ` from parent "${parentId}"` : "")
  );
}

/**
 * Hard-reject a `mergePolicy` set that would violate the ceiling lattice:
 * raising a node above its ceiling, or lowering a parent below a descendant.
 */
export function validateMergePolicyPatch(
  existing: Issue,
  patch: IssuePatch,
  issues: Issue[],
): void {
  if (!("mergePolicy" in patch)) return;
  if (
    existing.kind !== "project" &&
    existing.kind !== "epic" &&
    existing.kind !== "story"
  ) {
    return;
  }

  const next = mergeIssue(existing, patch);
  const prospective = issues.map((issue) =>
    issue.id === existing.id ? next : issue,
  );
  const byId = new Map(prospective.map((issue) => [issue.id, issue]));
  const cache = new Map<string, MergePolicy>();

  const check = (issue: Issue): void => {
    if (
      issue.kind !== "project" &&
      issue.kind !== "epic" &&
      issue.kind !== "story"
    ) {
      return;
    }
    const effective = effectiveMergePolicy(issue.id, byId, cache);
    const ceiling = mergePolicyCeiling(issue, byId, cache);
    if (
      ceiling !== undefined &&
      MERGE_POLICY_RANK[effective] > MERGE_POLICY_RANK[ceiling]
    ) {
      throw new IssueError(
        "validation",
        ceilingViolationMessage(issue, effective, ceiling),
      );
    }
  };

  // Prefer the updated node's own violation (raise-above-ceiling).
  check(next);
  for (const issue of prospective) {
    if (issue.id === existing.id) continue;
    check(issue);
  }
}
