import { channelForIssue } from "../kind.js";
import type { Issue } from "../schemas.js";
import { IssueError } from "./errors.js";

// The set of ids in an issue's subtree: the root itself plus every issue
// transitively `partOf` it. Rooted at a Project it yields the whole project
// (epics, their branches, and those branches' commits); rooted at an Epic it
// yields that Epic's branches and commits; rooted at a Branch it yields just
// that branch and its commits (stacked children are `partOf` the Epic, so they
// are not included). Shared by the CLI's project-scoped views and by `apply`,
// which uses it to bound the reconcile/prune scope to the declared root.
export function subtreeIds(
  issues: Issue[],
  rootId: string,
): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const issue of issues) {
    if (issue.kind === "project") continue;
    const bucket = childrenOf.get(issue.partOf) ?? [];
    bucket.push(issue.id);
    childrenOf.set(issue.partOf, bucket);
  }
  const ids = new Set<string>();
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (ids.has(current)) continue;
    ids.add(current);
    for (const child of childrenOf.get(current) ?? []) queue.push(child);
  }
  return ids;
}

/**
 * Walk `partOf` from `id` up to (and including) its Project.
 * Returns the chain in Project → … → target order.
 */
export function ancestorChain(id: string, issues: Issue[]): Issue[] {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const start = byId.get(id);
  if (!start) {
    throw new IssueError("not_found", `unknown issue "${id}"`);
  }

  const ascending: Issue[] = [];
  let current: Issue = start;
  const seen = new Set<string>();
  for (;;) {
    if (seen.has(current.id)) {
      throw new IssueError(
        "validation",
        `partOf cycle involving "${current.id}"`,
      );
    }
    seen.add(current.id);
    ascending.push(current);
    if (current.kind === "project") break;
    const parent = byId.get(current.partOf);
    if (!parent) {
      throw new IssueError(
        "validation",
        `broken partOf chain at "${current.id}" (unknown "${current.partOf}")`,
      );
    }
    current = parent;
  }

  ascending.reverse();
  if (ascending[0]?.kind !== "project") {
    throw new IssueError(
      "validation",
      `issue "${id}" is not under a project`,
    );
  }
  return ascending;
}

/**
 * The Story a Project → … → target chain belongs to: the target itself when it
 * is a Story, its parent when it is a Task, otherwise undefined.
 */
export function owningStory(
  chain: Issue[],
): Extract<Issue, { kind: "story" }> | undefined {
  const target = chain.at(-1);
  const story = target?.kind === "task" ? chain.at(-2) : target;
  return story?.kind === "story" ? story : undefined;
}

/**
 * Nearest Epic on a Project → … → target chain, or the project-level Story
 * when the chain has no Epic.
 */
export function nearestImplementingWorkRootId(
  chain: Issue[],
): string | undefined {
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const issue = chain[i]!;
    const parentKind = chain[i - 1]?.kind;
    const channel =
      issue.kind === "story"
        ? parentKind
          ? channelForIssue(issue, parentKind)
          : undefined
        : channelForIssue(issue);
    if (channel === "implementing") return issue.id;
  }
  return undefined;
}

/**
 * Project id that contains an Epic/Idea (via `partOf`), a Story (directly via
 * Project or via Epic), a Task (via its Story/Epic chain), or undefined when
 * the chain is broken.
 */
export function projectContaining(
  issue: Issue,
  byId: Map<string, Issue>,
): string | undefined {
  if (issue.kind === "epic" || issue.kind === "idea") return issue.partOf;
  if (issue.kind === "story") {
    const parent = byId.get(issue.partOf);
    if (parent?.kind === "project") return parent.id;
    if (parent?.kind === "epic") return parent.partOf;
    return undefined;
  }
  if (issue.kind === "task") {
    const parent = byId.get(issue.partOf);
    if (!parent) return undefined;
    return projectContaining(parent, byId);
  }
  return undefined;
}
