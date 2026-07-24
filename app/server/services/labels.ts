import type { Issue, ProjectLabel } from "../schemas.js";
import { IssueError } from "./errors.js";
import { isSlugSafe } from "./slug.js";
import { projectContaining } from "./subtree.js";

export type LabelCascadePatch = { id: string; labels: string[] };

function isAssignable(
  issue: Issue,
): issue is Extract<Issue, { kind: "epic" | "idea" | "story" }> {
  return issue.kind === "epic" || issue.kind === "idea" || issue.kind === "story";
}

/** Catalog ids removed when replacing a Project's `labels` array. */
export function removedCatalogIds(existing: Issue, next: Issue): string[] {
  if (existing.kind !== "project" || next.kind !== "project") return [];
  const nextIds = new Set((next.labels ?? []).map((label) => label.id));
  return (existing.labels ?? [])
    .map((label) => label.id)
    .filter((id) => !nextIds.has(id));
}

/**
 * When a same-length catalog patch drops exactly one id and adds exactly one,
 * treat it as a rename (UI / PATCH) rather than remove+add.
 */
export function singleCatalogIdRename(
  existing: Issue,
  next: Issue,
): { oldId: string; newId: string } | null {
  if (existing.kind !== "project" || next.kind !== "project") return null;
  const prev = existing.labels ?? [];
  const nxt = next.labels ?? [];
  if (prev.length !== nxt.length || prev.length === 0) return null;
  const prevIds = prev.map((label) => label.id);
  const nextIds = nxt.map((label) => label.id);
  const nextSet = new Set(nextIds);
  const prevSet = new Set(prevIds);
  const removed = prevIds.filter((id) => !nextSet.has(id));
  const added = nextIds.filter((id) => !prevSet.has(id));
  if (removed.length !== 1 || added.length !== 1) return null;
  return { oldId: removed[0], newId: added[0] };
}

/**
 * When a Project catalog drops ids, strip those ids from every Epic / Idea /
 * Story assignment in the same Project.
 */
export function planLabelCatalogCascade(
  existing: Issue,
  next: Issue,
  issues: Issue[],
): LabelCascadePatch[] {
  const removed = removedCatalogIds(existing, next);
  if (removed.length === 0) return [];
  const removedSet = new Set(removed);
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const projectId = existing.id;
  const patches: LabelCascadePatch[] = [];
  for (const issue of issues) {
    if (!isAssignable(issue)) continue;
    if (projectContaining(issue, byId) !== projectId) continue;
    if (!issue.labels?.length) continue;
    const kept = issue.labels.filter((id) => !removedSet.has(id));
    if (kept.length === issue.labels.length) continue;
    patches.push({ id: issue.id, labels: kept });
  }
  return patches;
}

/**
 * Plan catalog id rename + assignment rewrites. Refuses when `newId` is not
 * kebab-safe or already exists. Caller commits the returned patches.
 */
export function planLabelCatalogRename(
  project: Extract<Issue, { kind: "project" }>,
  oldId: string,
  newId: string,
  issues: Issue[],
): { projectLabels: ProjectLabel[]; assignmentPatches: LabelCascadePatch[] } {
  if (!isSlugSafe(newId)) {
    throw new IssueError(
      "validation",
      `new label id must be kebab-case (got "${newId}")`,
    );
  }
  const catalog = project.labels ?? [];
  if (!catalog.some((label) => label.id === oldId)) {
    throw new IssueError(
      "validation",
      `unknown label id "${oldId}" on project "${project.id}"`,
    );
  }
  if (oldId !== newId && catalog.some((label) => label.id === newId)) {
    throw new IssueError(
      "validation",
      `label id "${newId}" already exists on project "${project.id}"`,
    );
  }

  const projectLabels = catalog.map((label) =>
    label.id === oldId ? { ...label, id: newId } : label,
  );
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const assignmentPatches: LabelCascadePatch[] = [];
  for (const issue of issues) {
    if (!isAssignable(issue)) continue;
    if (projectContaining(issue, byId) !== project.id) continue;
    if (!issue.labels?.includes(oldId)) continue;
    assignmentPatches.push({
      id: issue.id,
      labels: issue.labels.map((id) => (id === oldId ? newId : id)),
    });
  }
  return { projectLabels, assignmentPatches };
}
