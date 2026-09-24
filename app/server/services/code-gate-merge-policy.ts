import { MERGE_POLICY_RANK } from "../fields.js";
import type { Issue, IssuePatch } from "../schemas.js";
import { derive } from "./derive.js";
import { effectiveMergePolicy } from "./merge-policy.js";

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
  const cache = new Map<string, import("../schemas.js").MergePolicy>();
  const patches: Issue[] = [];

  for (const rootId of planRoots) {
    const root = byId.get(rootId);
    if (
      !root ||
      (root.kind !== "project" &&
        root.kind !== "epic" &&
        root.kind !== "story")
    ) {
      continue;
    }
    const effective = effectiveMergePolicy(rootId, byId, cache);
    if (MERGE_POLICY_RANK[effective] <= MERGE_POLICY_RANK.manual) continue;
    patches.push({ ...root, mergePolicy: "manual" });
  }

  return patches;
}
