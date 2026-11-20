import { MERGE_POLICY_RANK } from "../fields.js";
import type { Issue, MergePolicy } from "../schemas.js";
import {
  effectiveMergePolicy,
  mergePolicyCeiling,
  mergePolicyDescendantIds,
} from "./merge-policy.js";

type MergePolicyNode = Extract<Issue, { kind: "project" | "epic" | "story" }>;

function isMergePolicyNode(issue: Issue | undefined): issue is MergePolicyNode {
  return (
    issue?.kind === "project" ||
    issue?.kind === "epic" ||
    issue?.kind === "story"
  );
}

function effectiveAboveManual(
  id: string,
  byId: Map<string, Issue>,
  cache: Map<string, MergePolicy>,
): boolean {
  return (
    MERGE_POLICY_RANK[effectiveMergePolicy(id, byId, cache)] >
    MERGE_POLICY_RANK.manual
  );
}

function violatesMergePolicyCeiling(
  id: string,
  byId: Map<string, Issue>,
  cache: Map<string, MergePolicy>,
): boolean {
  const issue = byId.get(id);
  if (!isMergePolicyNode(issue)) return false;
  const effective = effectiveMergePolicy(id, byId, cache);
  const ceiling = mergePolicyCeiling(issue, byId, cache);
  return (
    ceiling !== undefined &&
    MERGE_POLICY_RANK[effective] > MERGE_POLICY_RANK[ceiling]
  );
}

/**
 * Lower a work root, and any descendant left above the new ceiling, to
 * `manual` because its code needs approval. Nodes already at effective
 * `manual` get no redundant stored override.
 */
export function planCodeGateMergePolicyLowering(
  rootId: string,
  issues: Issue[],
): Issue[] {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const touchIds = new Set<string>([
    rootId,
    ...mergePolicyDescendantIds(rootId, issues),
  ]);

  const patchesById = new Map<string, MergePolicyNode>();
  const prospective = (): Map<string, Issue> => {
    const map = new Map(byId);
    for (const [id, issue] of patchesById) map.set(id, issue);
    return map;
  };

  let changed = true;
  while (changed) {
    changed = false;
    const map = prospective();
    const cache = new Map<string, MergePolicy>();
    for (const id of touchIds) {
      const issue = map.get(id);
      if (!isMergePolicyNode(issue)) continue;
      if (
        !effectiveAboveManual(id, map, cache) &&
        !violatesMergePolicyCeiling(id, map, cache)
      ) {
        continue;
      }
      if (patchesById.get(id)?.mergePolicy === "manual") continue;
      patchesById.set(id, { ...issue, mergePolicy: "manual" });
      changed = true;
    }
  }

  return [...patchesById.values()];
}
