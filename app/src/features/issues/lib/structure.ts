import { visibleIssues } from "@server/services/archived-visibility";
import type { IssueRecord } from "@server/schemas";
import type { BoardKindFilter } from "./board-kind-filter";
import { buildTree, filterToProject, type IssueNode } from "./build-tree";
import { filterIssuesBySearchAndLabels } from "./filter-by-search-labels";
import { projectBoardRoots } from "./project-board-roots";

export type StructureFilters = {
  search: string;
  labelIds: readonly string[];
  kind: BoardKindFilter;
};

/** Visible issues under a project (archive filter applied). */
export function structureScopedIssues(
  issues: IssueRecord[],
  projectId: string,
  showArchived: boolean,
): IssueRecord[] {
  return visibleIssues(
    filterToProject(issues, projectId || null),
    showArchived,
  );
}

/**
 * Containment tree roots for the Structure lens after search / label / kind
 * filters. Pure view-model — no I/O.
 */
export function structureTreeNodes(
  scoped: IssueRecord[],
  filters: StructureFilters,
): IssueNode[] {
  const filtered = filterIssuesBySearchAndLabels(
    scoped,
    filters.search,
    filters.labelIds,
  );
  const roots = projectBoardRoots(filtered, filters.kind);
  return buildTree(filtered, roots);
}
