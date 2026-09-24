import { MERGE_POLICY_RANK } from "../fields.js";
import type { Issue, IssuePatch, MergePolicy } from "../schemas.js";
import { derive } from "./derive.js";
import {
  effectiveMergePolicy,
  mergePolicyCeiling,
  mergePolicyDescendantIds,
} from "./merge-policy.js";

function isMergePolicyNode(
  issue: Issue | undefined,
): issue is Extract<Issue, { kind: "project" | "epic" | "story" }> {
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

/** Lower plan roots to manual when archiving an Idea with a code-approval verdict. */
export function planCodeGateMergePolicyLowering(
  existing: Issue,
  patch: IssuePatch,
  issues: Issue[],
): Issue[] {
  if (existing.kind !== "idea" || existing.archived) return [];
  if (patch.archived !== true) return [];
  if (existing.codeApprovalRequired !== true) return [];

  const planRoots = derive(issues).byId[existing.id]?.planRoots ?? [];
  if (planRoots.length === 0) return [];

  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const touchIds = new Set<string>();
  for (const rootId of planRoots) {
    touchIds.add(rootId);
    for (const id of mergePolicyDescendantIds(rootId, issues)) {
      touchIds.add(id);
    }
  }

  const patchesById = new Map<string, Issue>();
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
