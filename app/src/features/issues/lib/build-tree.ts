import type { IssueRecord } from "@server/schemas";
import { storyDependencyIds, bySequence, isProjectBoardChild } from "@server/order";

export interface IssueNode {
  issue: IssueRecord;
  children: IssueNode[];
}

export function parentOf(issue: IssueRecord): string | undefined {
  return "partOf" in issue ? issue.partOf : undefined;
}

export function issuesById(
  issues: IssueRecord[],
): Map<string, IssueRecord> {
  return new Map(issues.map((issue) => [issue.id, issue]));
}

export function listProjects(issues: IssueRecord[]): IssueRecord[] {
  return issues
    .filter((issue): issue is IssueRecord & { kind: "project" } =>
      issue.kind === "project",
    )
    .sort(bySequence);
}

/** Walk `partOf` to the containing project id, or the id itself if it is a project. */
export function projectIdOf(
  issueId: string,
  byId: Map<string, IssueRecord>,
): string | null {
  let current = byId.get(issueId);
  while (current) {
    if (current.kind === "project") return current.id;
    const parent = parentOf(current);
    if (!parent) return null;
    current = byId.get(parent);
  }
  return null;
}

export function issueBelongsToProject(
  issueId: string,
  projectId: string,
  byId: Map<string, IssueRecord>,
): boolean {
  return projectIdOf(issueId, byId) === projectId;
}

// Issues belonging to a project: the project node (when present) plus every
// issue whose `partOf` chain reaches it (epics, their branches, commits, etc.).
export function filterToProject(
  issues: IssueRecord[],
  projectId: string | null,
): IssueRecord[] {
  if (!projectId) return [];
  const childrenOf = new Map<string, IssueRecord[]>();
  for (const issue of issues) {
    const parent = parentOf(issue);
    if (!parent) continue;
    const bucket = childrenOf.get(parent) ?? [];
    bucket.push(issue);
    childrenOf.set(parent, bucket);
  }
  const kept: IssueRecord[] = [];
  const project = issues.find(
    (issue) => issue.id === projectId && issue.kind === "project",
  );
  const queue = project
    ? [project]
    : [...(childrenOf.get(projectId) ?? [])];
  while (queue.length > 0) {
    const issue = queue.shift()!;
    kept.push(issue);
    for (const child of childrenOf.get(issue.id) ?? []) queue.push(child);
  }
  return kept;
}

function storyDeps(story: IssueRecord, siblings: Set<string>): string[] {
  if (story.kind !== "story") return [];
  return storyDependencyIds(story).filter((id) => siblings.has(id));
}

function orderSiblings(children: IssueRecord[]): IssueRecord[] {
  const sequenced = [...children].sort(bySequence);
  if (!sequenced.every((child) => child.kind === "story")) return sequenced;

  const ids = new Set(sequenced.map((child) => child.id));
  const placed = new Set<string>();
  const ordered: IssueRecord[] = [];
  while (ordered.length < sequenced.length) {
    const next =
      sequenced.find(
        (child) =>
          !placed.has(child.id) &&
          storyDeps(child, ids).every((dep) => placed.has(dep)),
      ) ?? sequenced.find((child) => !placed.has(child.id));
    if (!next) break;
    ordered.push(next);
    placed.add(next.id);
  }
  return ordered;
}

// Tasks first (the story's own work), then the stories stacked on it.
function orderChildren(children: IssueRecord[]): IssueRecord[] {
  const tasks = children
    .filter((child) => child.kind === "task")
    .sort(bySequence);
  const stories = orderSiblings(
    children.filter((child) => child.kind === "story"),
  );
  return [...tasks, ...stories];
}

export function buildTree(
  issues: IssueRecord[],
  roots?: IssueRecord[],
): IssueNode[] {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));

  // A branch nests under the branch it forks from (its stackedOn) when that
  // referent is a branch in the same epic and present here; otherwise it falls
  // back to its epic as a root branch.
  const visualParent = (issue: IssueRecord): string | undefined => {
    if (issue.kind === "story" && issue.stackedOn) {
      const base = byId.get(issue.stackedOn);
      if (base?.kind === "story" && base.partOf === issue.partOf) {
        return base.id;
      }
    }
    return parentOf(issue);
  };

  const childrenOf = new Map<string, IssueRecord[]>();
  for (const issue of issues) {
    const parent = visualParent(issue);
    if (!parent) continue;
    const bucket = childrenOf.get(parent) ?? [];
    bucket.push(issue);
    childrenOf.set(parent, bucket);
  }

  const toNode = (issue: IssueRecord): IssueNode => ({
    issue,
    children: orderChildren(childrenOf.get(issue.id) ?? []).map(toNode),
  });

  const rootIssues =
    roots ??
    issues.filter((issue) => isProjectBoardChild(issue, byId)).sort(bySequence);
  return rootIssues.map(toNode);
}
