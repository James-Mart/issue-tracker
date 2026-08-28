import { visibleIssues } from "@server/services/archived-visibility";
import type { DerivedState, IssueRecord } from "@server/schemas";
import { boardKindAllows, type BoardKindFilter } from "./board-kind-filter";
import { buildTree, filterToProject, type IssueNode } from "./build-tree";
import { isIssueComplete } from "./derived";
import { filterIssuesBySearchAndLabels } from "./filter-by-search-labels";
import { projectBoardRoots } from "./project-board-roots";

export type StructureDerived = Record<string, DerivedState>;

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

function filteredBoardRoots(
  scoped: IssueRecord[],
  filters: StructureFilters,
): IssueRecord[] {
  return projectBoardRoots(
    filterIssuesBySearchAndLabels(
      scoped,
      filters.search,
      filters.labelIds,
    ),
    filters.kind,
  );
}

function epicStoryBoardRoots(
  scoped: IssueRecord[],
  filters: StructureFilters,
): IssueRecord[] {
  return filteredBoardRoots(scoped, filters).filter(
    (issue) => issue.kind !== "idea",
  );
}

function structureEpicStoryNodes(
  scoped: IssueRecord[],
  filters: StructureFilters,
  roots: IssueRecord[],
): IssueNode[] {
  const filtered = filterIssuesBySearchAndLabels(
    scoped,
    filters.search,
    filters.labelIds,
  );
  return buildTree(filtered, roots);
}

/**
 * Epic / Story hierarchy roots for the Structure lens after search / label /
 * kind filters. Complete board roots are excluded — they render in
 * {@link structureDoneNodes}. Ideas are excluded — they render in
 * {@link structureIdeaNodes}.
 */
export function structureTreeNodes(
  scoped: IssueRecord[],
  filters: StructureFilters,
  derived: StructureDerived,
): IssueNode[] {
  const roots = epicStoryBoardRoots(scoped, filters).filter(
    (issue) => !isIssueComplete(issue, derived[issue.id]),
  );
  return structureEpicStoryNodes(scoped, filters, roots);
}

/**
 * Complete Epic / project-level Story roots for the Structure lens Done group
 * (same search / label / kind filters and tree shape as the active rail).
 */
export function structureDoneNodes(
  scoped: IssueRecord[],
  filters: StructureFilters,
  derived: StructureDerived,
): IssueNode[] {
  const roots = epicStoryBoardRoots(scoped, filters).filter((issue) =>
    isIssueComplete(issue, derived[issue.id]),
  );
  return structureEpicStoryNodes(scoped, filters, roots);
}

/**
 * Flat Idea rows for the Structure lens Ideas group (same search / label / kind
 * filters as the hierarchy tree).
 */
export function structureIdeaNodes(
  scoped: IssueRecord[],
  filters: StructureFilters,
): IssueNode[] {
  if (!boardKindAllows("idea", filters.kind)) return [];
  return filteredBoardRoots(scoped, filters)
    .filter((issue) => issue.kind === "idea")
    .map((issue) => ({ issue, children: [] }));
}
