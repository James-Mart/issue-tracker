import { hasArchived } from "../kind.js";
import type { Issue } from "../schemas.js";
import { ancestorChain } from "./subtree.js";

/** True when the issue is an archived Epic / Idea / Story / Task. */
export function isArchived(issue: Issue): boolean {
  return hasArchived(issue) && issue.archived;
}

/**
 * Archive visibility for list and full-graph reads. Projects are never
 * archived; archived rows are omitted unless `showArchived` is true.
 * Structure, cockpit, and the default `issue tree` use `outlineIssues`.
 */
export function visibleIssues<T extends Issue>(
  issues: T[],
  showArchived: boolean,
): T[] {
  if (showArchived) return issues;
  return issues.filter((issue) => !isArchived(issue));
}

/**
 * Planning outlines: the structure lens, the cockpit, and the default
 * `issue tree`. Review issues stay on the code review lens.
 */
export function outlineIssues<T extends Issue>(
  issues: T[],
  showArchived: boolean,
): T[] {
  return visibleIssues(issues, showArchived).filter((issue) => issue.kind !== "review");
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
