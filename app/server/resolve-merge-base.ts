import type { Issue } from "./schemas.js";

type Story = Extract<Issue, { kind: "story" }>;

function storyById(issues: Issue[]): Map<string, Story> {
  const map = new Map<string, Story>();
  for (const issue of issues) {
    if (issue.kind === "story") map.set(issue.id, issue);
  }
  return map;
}

function resolveMergeBaseInner(
  stackedOn: string | undefined,
  storiesById: Map<string, Story>,
  visiting: Set<string>,
  trunk: string,
): string | undefined {
  if (!stackedOn) return trunk;
  if (visiting.has(stackedOn)) return undefined;
  const parent = storiesById.get(stackedOn);
  if (!parent) return undefined;
  if (parent.merged) {
    visiting.add(stackedOn);
    return resolveMergeBaseInner(parent.stackedOn, storiesById, visiting, trunk);
  }
  return parent.branchName;
}

/**
 * Derive a Story's `mergeBase` from topology: root/unstacked → `trunk`;
 * stacked on a merged parent → `resolve(parent)`; else parent's `branchName`
 * when set; else unset. No on-disk key. Pure — safe for client bundles.
 */
export function resolveMergeBase(
  stackedOn: string | undefined,
  issues: Issue[],
  storiesById?: Map<string, Story>,
  trunk = "main",
): string | undefined {
  return resolveMergeBaseInner(
    stackedOn,
    storiesById ?? storyById(issues),
    new Set(),
    trunk,
  );
}
