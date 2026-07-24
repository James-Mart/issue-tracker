import type { Issue, IssueKind } from "./schemas.js";

type Sequenced = Pick<Issue, "order">;

export function bySequence(a: Sequenced, b: Sequenced): number {
  return a.order - b.order;
}

// The sibling group an issue's `order` is unique within: same parent, and for
// Stories also the same fork point, so root Stories (no `stackedOn`) share one
// bucket and each stack shares another — matching the DFS traversal below and
// the readiness walk in derive.ts. Projects share a single global group. Epic,
// Idea, and *root* project-level Stories share one Project-keyed group
// (interleaved under the Project); stacked project-level Stories use a stack
// bucket. This is the one definition of "siblings"; both the integrity
// duplicate-order check and the append math in the writers key off it so they
// can never disagree.
function groupKeyFor(
  kind: IssueKind,
  partOf: string | undefined,
  stackedOn: string | undefined,
  parentKind?: IssueKind,
): string {
  switch (kind) {
    case "project":
      return "project";
    case "epic":
    case "idea":
      return `project:${partOf}`;
    case "task":
      return `task:${partOf}`;
    case "story":
      // Root project-level Stories (no fork point) share the Project board
      // order with Epics/Ideas. Stacked project-level Stories stay in a
      // stack sibling bucket keyed by fork point, matching epic-parented
      // Stories — so a nested `stacked:` child can reuse order 0 without
      // colliding with its board-root parent.
      if (parentKind === "project" && !stackedOn) {
        return `project:${partOf}`;
      }
      return `story:${partOf}:${stackedOn ?? ""}`;
  }
}

function parentKindOf(
  partOf: string | undefined,
  byId: ReadonlyMap<string, Issue>,
): IssueKind | undefined {
  return partOf ? byId.get(partOf)?.kind : undefined;
}

/** `order` sibling-group key; `byId` resolves a Story's parent kind. */
export function siblingGroupKey(
  issue: Issue,
  byId: ReadonlyMap<string, Issue>,
): string {
  const partOf = "partOf" in issue ? issue.partOf : undefined;
  const parentKind =
    issue.kind === "story" ? parentKindOf(partOf, byId) : undefined;
  return groupKeyFor(
    issue.kind,
    partOf,
    issue.kind === "story" ? issue.stackedOn : undefined,
    parentKind,
  );
}

export type ProjectBoardChild = Extract<
  Issue,
  { kind: "epic" | "idea" | "story" }
>;

export function projectBoardGroupKey(projectId: string): string {
  return `project:${projectId}`;
}

/**
 * Epic, Idea, and project-level Story rows that share one Project-keyed
 * sibling `order` group. `byId` resolves whether a Story's `partOf` is a
 * Project.
 */
export function isProjectBoardChild(
  issue: Issue,
  byId: ReadonlyMap<string, Issue>,
): issue is ProjectBoardChild {
  if (
    issue.kind !== "epic" &&
    issue.kind !== "idea" &&
    issue.kind !== "story"
  ) {
    return false;
  }
  return (
    siblingGroupKey(issue, byId) === projectBoardGroupKey(issue.partOf)
  );
}

/** One pass over `issues` → each Project's interleaved board children. */
export function buildProjectBoardOf(
  issues: Issue[],
): Map<string, ProjectBoardChild[]> {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const boardOf = new Map<string, ProjectBoardChild[]>();
  for (const issue of issues) {
    if (!isProjectBoardChild(issue, byId)) continue;
    const bucket = boardOf.get(issue.partOf) ?? [];
    bucket.push(issue);
    boardOf.set(issue.partOf, bucket);
  }
  for (const bucket of boardOf.values()) bucket.sort(bySequence);
  return boardOf;
}

// The next free `order` for a new node in a sibling group: one past the current
// max (append), or 0 when the group is empty. `excludeId` drops the node itself
// when recomputing on a move. Shared by imperative `create`/reparent and by
// `apply` for a brand-new root node, so a new sibling never collides at 0.
export function nextSiblingOrder(
  issues: Issue[],
  kind: IssueKind,
  partOf: string | undefined,
  stackedOn: string | undefined,
  excludeId?: string,
): number {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const key = groupKeyFor(
    kind,
    partOf,
    stackedOn,
    parentKindOf(partOf, byId),
  );
  let max = -1;
  for (const issue of issues) {
    if (issue.id === excludeId) continue;
    if (siblingGroupKey(issue, byId) !== key) continue;
    if (issue.order > max) max = issue.order;
  }
  return max + 1;
}

type StoryLike = Extract<Issue, { kind: "story" }>;

// A Story's only inter-Story edge is its single `stackedOn` fork point;
// `blockedBy` is Epic-level now and never a Story dependency. Consumed by the
// integrity cycle check.
export function storyDependencyIds(story: StoryLike): string[] {
  return story.stackedOn ? [story.stackedOn] : [];
}

type EpicLike = Extract<Issue, { kind: "epic" }>;

// An Epic's dependency edges are exactly its `blockedBy` ids (each an Epic in
// the same Project). Peer to `storyDependencyIds` so the integrity cycle check
// builds both graph kinds through one named extractor apiece, and stays a thin
// assembler over them.
export function epicDependencyIds(epic: EpicLike): string[] {
  return epic.blockedBy;
}

// The reverse of `epicDependencyIds`: every Epic that lists `blockerId` in its
// `blockedBy` — the Epics waiting on this one. Named here beside the forward
// edge so both directions of the Epic dependency graph read from `order.ts`
// instead of being re-filtered inline in a view. Generic over the epic shape so
// the UI (`IssueRecord` epics) and the CLI can share the one traversal.
export function epicsBlockedBy<T extends Issue>(
  blockerId: string,
  issues: T[],
): Extract<T, { kind: "epic" }>[] {
  return issues.filter(
    (i): i is Extract<T, { kind: "epic" }> =>
      i.kind === "epic" && i.blockedBy.includes(blockerId),
  );
}

// Order a parent Epic's Branches for structural traversal (the tree / a stacked
// PR plan), independent of the merged-gated `ready` set. Branches are emitted
// depth-first: root Branches (no `stackedOn`, or a `stackedOn` outside this set)
// first, each immediately followed by the Branches stacked on it, recursively.
// Siblings at every level are ordered by stored `order`. Only `stackedOn`
// nests here; `blockedBy` is a cross-Epic dependency, not a fork point, so it
// does not affect this order. Generic over the branch shape so the CLI (with
// its `IssueRecord` branches) and a future SDK script can share one traversal.
export function stackedStoryOrder<T extends StoryLike>(stories: T[]): T[] {
  const inSet = new Set(stories.map((s) => s.id));
  const roots: T[] = [];
  const childrenOf = new Map<string, T[]>();
  for (const story of stories) {
    if (story.stackedOn && inSet.has(story.stackedOn)) {
      const bucket = childrenOf.get(story.stackedOn) ?? [];
      bucket.push(story);
      childrenOf.set(story.stackedOn, bucket);
    } else {
      roots.push(story);
    }
  }
  roots.sort(bySequence);
  for (const bucket of childrenOf.values()) bucket.sort(bySequence);

  const ordered: T[] = [];
  const seen = new Set<string>();
  const visit = (story: T): void => {
    if (seen.has(story.id)) return; // defensive: a stackedOn cycle is a problem
    seen.add(story.id);
    ordered.push(story);
    for (const child of childrenOf.get(story.id) ?? []) visit(child);
  };
  for (const root of roots) visit(root);
  return ordered;
}

// The Story at `rootId` plus every Story that transitively `stackedOn`-
// descends from it, ordered by `stackedStoryOrder` (DFS + sibling `order`).
// Collection walks the reverse stackedOn edges; ordering stays one definition.
export function stackedOnSubtree<T extends StoryLike>(
  stories: T[],
  rootId: string,
): T[] {
  const byId = new Map(stories.map((s) => [s.id, s]));
  if (!byId.has(rootId)) return [];

  const childrenOf = new Map<string, T[]>();
  for (const story of stories) {
    if (!story.stackedOn) continue;
    const bucket = childrenOf.get(story.stackedOn) ?? [];
    bucket.push(story);
    childrenOf.set(story.stackedOn, bucket);
  }

  const members: T[] = [];
  const seen = new Set<string>();
  const collect = (id: string): void => {
    if (seen.has(id)) return;
    const story = byId.get(id);
    if (!story) return;
    seen.add(id);
    members.push(story);
    for (const child of childrenOf.get(id) ?? []) collect(child.id);
  };
  collect(rootId);
  return stackedStoryOrder(members);
}
