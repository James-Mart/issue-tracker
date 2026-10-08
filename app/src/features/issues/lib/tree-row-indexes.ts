import type { IssueRecord } from "@server/schemas";
import { issuesById, parentOf } from "./build-tree";

export type LeafTaskProgress = {
  done: number;
  total: number;
};

/**
 * Shared row lookups for one `issues` snapshot: id map, children by `partOf`,
 * and leaf-task progress for Stories and Epics. Build once when `issues`
 * changes; row helpers read this object and do not scan the array.
 */
export type TreeRowIndexes = {
  byId: Map<string, IssueRecord>;
  childrenByParent: Map<string, IssueRecord[]>;
  leafTaskProgress: Map<string, LeafTaskProgress>;
};

/**
 * Done/total for items whose `statusOf` returns a status.
 * `undefined` skips the item. Undefined overall when none count.
 */
export function progressOfTasks<T>(
  items: Iterable<T>,
  statusOf: (item: T) => string | undefined,
): LeafTaskProgress | undefined {
  let done = 0;
  let total = 0;
  for (const item of items) {
    const status = statusOf(item);
    if (status === undefined) continue;
    total += 1;
    if (status === "done") done += 1;
  }
  if (total === 0) return undefined;
  return { done, total };
}

function taskProgress(
  children: readonly IssueRecord[] | undefined,
): LeafTaskProgress | undefined {
  if (!children) return undefined;
  return progressOfTasks(children, (child) =>
    child.kind === "task" ? child.status : undefined,
  );
}

function summedStoryProgress(
  children: readonly IssueRecord[] | undefined,
  leafTaskProgress: Map<string, LeafTaskProgress>,
): LeafTaskProgress | undefined {
  if (!children) return undefined;
  let done = 0;
  let total = 0;
  for (const child of children) {
    if (child.kind !== "story") continue;
    const progress = leafTaskProgress.get(child.id);
    if (!progress) continue;
    done += progress.done;
    total += progress.total;
  }
  if (total === 0) return undefined;
  return { done, total };
}

/**
 * Leaf-task progress for a row. Stories and in-snapshot Epics are map hits.
 * An Epic that is not in the snapshot sums its indexed story children.
 */
export function leafTaskProgressOf(
  issue: IssueRecord,
  indexes: TreeRowIndexes,
): LeafTaskProgress | undefined {
  const stored = indexes.leafTaskProgress.get(issue.id);
  if (stored) return stored;
  if (issue.kind !== "epic" || indexes.byId.has(issue.id)) return undefined;
  return summedStoryProgress(
    indexes.childrenByParent.get(issue.id),
    indexes.leafTaskProgress,
  );
}

/** One pass over `issues` into {@link TreeRowIndexes}. */
export function buildTreeRowIndexes(
  issues: readonly IssueRecord[],
): TreeRowIndexes {
  const byId = issuesById(issues);
  const childrenByParent = new Map<string, IssueRecord[]>();
  for (const issue of issues) {
    const parent = parentOf(issue);
    if (!parent) continue;
    const bucket = childrenByParent.get(parent) ?? [];
    bucket.push(issue);
    childrenByParent.set(parent, bucket);
  }

  const leafTaskProgress = new Map<string, LeafTaskProgress>();
  for (const [parentId, children] of childrenByParent) {
    const parent = byId.get(parentId);
    if (parent && parent.kind !== "story") continue;
    const progress = taskProgress(children);
    if (progress) leafTaskProgress.set(parentId, progress);
  }

  for (const issue of issues) {
    if (issue.kind !== "epic") continue;
    const progress = summedStoryProgress(
      childrenByParent.get(issue.id),
      leafTaskProgress,
    );
    if (progress) leafTaskProgress.set(issue.id, progress);
  }

  return { byId, childrenByParent, leafTaskProgress };
}
