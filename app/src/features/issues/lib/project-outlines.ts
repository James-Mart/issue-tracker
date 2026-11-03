import type { IssueRecord } from "@server/schemas";
import { visibleIssues } from "@server/services/archived-visibility";

export type OutlineRecord = Extract<IssueRecord, { kind: "outline" }>;

export const PROJECT_OUTLINES_EMPTY_TITLE = "No outlines yet";

export const PROJECT_OUTLINES_EMPTY_DETAIL =
  "This project has no outlines yet. Planning an Idea creates one.";

/**
 * Outlines whose parent is this Project, newest `updatedAt` first.
 * A body save stamps `updatedAt`; version snapshots have no clock of their
 * own. Ties break by id. `showArchived` matches the rest of the tree.
 */
export function outlinesForProject(
  issues: IssueRecord[],
  projectId: string,
  showArchived: boolean,
): OutlineRecord[] {
  return visibleIssues(issues, showArchived)
    .filter(
      (issue): issue is OutlineRecord =>
        issue.kind === "outline" && issue.partOf === projectId,
    )
    .sort(byRecentVersion);
}

/** Latest saved body, shown as `v3`. */
export function outlineVersionLabel(bodyVersion: number): string {
  return `v${bodyVersion}`;
}

/** Linked roots stay zero until outline linking exists. */
export const PROJECT_OUTLINES_LINKED_ROOTS_LABEL = "0 roots";

function byRecentVersion(a: OutlineRecord, b: OutlineRecord): number {
  const byTime = b.updatedAt.localeCompare(a.updatedAt);
  return byTime === 0 ? a.id.localeCompare(b.id) : byTime;
}
