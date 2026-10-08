import { isArchived } from "@server/services/archived-visibility";
import type { IssueRecord, IssuesResponse } from "@server/schemas";
import { parentOf } from "./build-tree";

/**
 * Archived rows come from `?archived=only`. Live rows stay on the default
 * list. An archived issue that is only on the default list is left out.
 */
export function mergeLiveWithArchivedOnly(
  live: IssuesResponse,
  archivedOnly: IssuesResponse,
): IssuesResponse {
  if (
    !live.issues.some((issue) => isArchived(issue)) &&
    !archivedOnly.issues.some((issue) => isArchived(issue))
  ) {
    return live;
  }
  const archivedById = new Map(
    archivedOnly.issues
      .filter((issue) => isArchived(issue))
      .map((issue) => [issue.id, issue]),
  );
  const issues: IssueRecord[] = [];
  const emitted = new Set<string>();
  for (const issue of live.issues) {
    if (isArchived(issue)) {
      const fromOnly = archivedById.get(issue.id);
      if (!fromOnly) continue;
      issues.push(fromOnly);
      emitted.add(issue.id);
      continue;
    }
    issues.push(issue);
    emitted.add(issue.id);
  }
  for (const issue of archivedOnly.issues) {
    if (!isArchived(issue) || emitted.has(issue.id)) continue;
    issues.push(issue);
    emitted.add(issue.id);
  }

  const derived: IssuesResponse["derived"] = {};
  for (const issue of issues) {
    const state = isArchived(issue)
      ? archivedOnly.derived[issue.id]
      : live.derived[issue.id];
    if (state) derived[issue.id] = state;
  }

  const archivedIds = new Set(
    [...emitted].filter((id) => archivedById.has(id)),
  );
  const kept = new Set(issues.map((issue) => issue.id));
  return {
    issues,
    derived,
    problems: [
      ...live.problems.filter(
        (problem) => kept.has(problem.id) && !archivedIds.has(problem.id),
      ),
      ...archivedOnly.problems.filter((problem) => kept.has(problem.id)),
    ],
  };
}

/**
 * Ids in `rootIds` that `byId` does not hold yet. When `ancestors` is set,
 * also the first missing `partOf` parent of each root already in the map.
 */
export function missingChainIds(
  rootIds: readonly string[],
  byId: ReadonlyMap<string, IssueRecord>,
  ancestors = false,
): string[] {
  const missing: string[] = [];
  const queued = new Set<string>();
  const note = (id: string) => {
    if (!id || byId.has(id) || queued.has(id)) return;
    queued.add(id);
    missing.push(id);
  };
  for (const id of rootIds) {
    if (!byId.has(id)) {
      note(id);
      continue;
    }
    if (!ancestors) continue;
    let current = byId.get(id);
    const seen = new Set<string>();
    while (current) {
      const parent = parentOf(current);
      if (!parent || seen.has(parent)) break;
      seen.add(parent);
      if (!byId.has(parent)) {
        note(parent);
        break;
      }
      current = byId.get(parent);
    }
  }
  return missing;
}
