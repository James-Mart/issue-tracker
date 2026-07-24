import type { IssueRecord } from "@server/schemas";
import { filterWithAncestors } from "./filter-with-ancestors";
import { issueMatchesLabelFilter } from "./project-labels";
import { issueMatchesSearch } from "./search";

/**
 * Sequential search then label filter via `filterWithAncestors`, so an Epic
 * matching labels while a child matches search still survives.
 */
export function filterIssuesBySearchAndLabels(
  issues: IssueRecord[],
  search: string,
  labelIds: readonly string[],
): IssueRecord[] {
  let next = issues;
  if (search.trim()) {
    next = filterWithAncestors(next, (issue) =>
      issueMatchesSearch(issue, search),
    );
  }
  if (labelIds.length > 0) {
    const ids = [...labelIds];
    next = filterWithAncestors(next, (issue) =>
      issueMatchesLabelFilter(issue, ids),
    );
  }
  return next;
}
