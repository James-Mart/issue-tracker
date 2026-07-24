import { hasArchived } from "../kind.js";
import type { Issue } from "../schemas.js";
import { ancestorChain } from "./subtree.js";

/** True when the issue is an archived Epic / Idea / Story / Task. */
export function isArchived(issue: Issue): boolean {
  return hasArchived(issue) && issue.archived;
}

/**
 * Issues visible in tree/list views. Projects are never archived; Epic /
 * Idea / Branch / Commit rows are omitted unless `showArchived` is true.
 * Shared by CLI and UI so the filter rule cannot fork.
 */
export function visibleIssues<T extends Issue>(
  issues: T[],
  showArchived: boolean,
): T[] {
  if (showArchived) return issues;
  return issues.filter((issue) => !isArchived(issue));
}

/** True when any partOf ancestor (including the parent itself) is archived. */
export function ancestorIsArchived(
  partOf: string | undefined,
  issues: Issue[],
): boolean {
  if (!partOf) return false;
  try {
    return ancestorChain(partOf, issues).some(isArchived);
  } catch {
    // Broken / unknown parent: create/apply integrity checks fail separately.
    return false;
  }
}
