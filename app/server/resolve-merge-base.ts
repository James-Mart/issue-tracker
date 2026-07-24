import type { Issue } from "./schemas.js";

type Story = Extract<Issue, { kind: "story" }>;

function storyById(issues: Issue[]): Map<string, Story> {
  const map = new Map<string, Story>();
  for (const issue of issues) {
    if (issue.kind === "story") map.set(issue.id, issue);
  }
  return map;
}

function issueById(issues: Issue[]): Map<string, Issue> {
  return new Map(issues.map((issue) => [issue.id, issue]));
}

/** Unstacked Story: root override, else Epic override, else trunk. */
function unstackedMergeBase(
  story: Story,
  byId: Map<string, Issue>,
  trunk: string,
): string {
  const parent = byId.get(story.partOf);
  if (parent?.kind === "epic") {
    return parent.mergeBaseOverride ?? trunk;
  }
  return story.mergeBaseOverride ?? trunk;
}

function resolveMergeBaseInner(
  story: Story,
  storiesById: Map<string, Story>,
  byId: Map<string, Issue>,
  visiting: Set<string>,
  trunk: string,
): string | undefined {
  if (!story.stackedOn) return unstackedMergeBase(story, byId, trunk);
  if (visiting.has(story.stackedOn)) return undefined;
  const parent = storiesById.get(story.stackedOn);
  if (!parent) return undefined;
  if (parent.merged) {
    visiting.add(story.stackedOn);
    return resolveMergeBaseInner(parent, storiesById, byId, visiting, trunk);
  }
  return parent.branchName;
}

/**
 * Derive a Story's `mergeBase` from topology + optional overrides:
 * root/unstacked → `mergeBaseOverride` (Story or parent Epic) else `trunk`;
 * stacked on a merged parent → `resolve(parent)`; else parent's `branchName`
 * when set; else unset. Pure — safe for client bundles.
 *
 * Optional `storiesById` / `issuesById` avoid rebuilding maps on hot paths
 * (e.g. `derive`); built from `issues` when omitted.
 */
export function resolveMergeBase(
  story: Story,
  issues: Issue[],
  storiesById?: Map<string, Story>,
  trunk = "main",
  issuesById?: Map<string, Issue>,
): string | undefined {
  return resolveMergeBaseInner(
    story,
    storiesById ?? storyById(issues),
    issuesById ?? issueById(issues),
    new Set(),
    trunk,
  );
}
