import { useLayoutEffect, useMemo } from "react";
import type { ProjectLabel } from "@server/schemas";
import { ShellState } from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import { useIssuesIncludingArchived } from "../hooks/use-issues-with-archived";
import { type FlowFilters, flowFiltersActive } from "../lib/flow";
import { projectBoardRoots } from "../lib/project-board-roots";
import {
  structureDoneNodes,
  structureIdeaNodes,
  structureScopedIssues,
  structureTreeNodes,
} from "../lib/structure";
import { useIssueUiStore } from "../store/use-issue-ui-store";
import { IssueTree } from "./issue-tree";
import { OverviewFlowFilters } from "./overview-flow-filters";

/** Structure peer: search, labels, kind, archived, and the project tree. */
export function ProjectStructureSection({
  projectId,
  catalog,
}: {
  projectId: string;
  catalog: ProjectLabel[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <OverviewFlowFilters projectId={projectId} catalog={catalog} />
      <ProjectStructureLens projectId={projectId} catalog={catalog} />
    </div>
  );
}

/** Project structure tree. The caller owns search, labels, kind, and archived. */
function ProjectStructureLens({
  projectId,
  catalog,
}: {
  projectId: string;
  catalog: ProjectLabel[];
}) {
  const search = useIssueUiStore((s) => s.search);
  const setSearch = useIssueUiStore((s) => s.setSearch);
  const labelFilter = useIssueUiStore((s) => s.labelFilter);
  const setLabelFilter = useIssueUiStore((s) => s.setLabelFilter);
  const boardKindFilter = useIssueUiStore((s) => s.boardKindFilter);
  const setBoardKindFilter = useIssueUiStore((s) => s.setBoardKindFilter);
  const showArchived = useIssueUiStore((s) => s.showArchived);
  const listed = useIssuesIncludingArchived(showArchived);
  const viewIssues = listed.data?.issues ?? [];
  const viewDerived = listed.data?.derived ?? {};

  const filters: FlowFilters = useMemo(
    () => ({
      search,
      labelIds: labelFilter,
      kind: boardKindFilter,
    }),
    [boardKindFilter, labelFilter, search],
  );
  const filtersOn = flowFiltersActive(filters);

  const scoped = useMemo(
    () => structureScopedIssues(viewIssues, projectId, showArchived),
    [viewIssues, projectId, showArchived],
  );
  const nodes = useMemo(
    () => structureTreeNodes(scoped, filters, viewDerived),
    [viewDerived, filters, scoped],
  );
  const ideaNodes = useMemo(
    () => structureIdeaNodes(scoped, filters),
    [filters, scoped],
  );
  const doneNodes = useMemo(
    () => structureDoneNodes(scoped, filters, viewDerived),
    [viewDerived, filters, scoped],
  );
  const boardRootIds = useMemo(
    () => projectBoardRoots(scoped, []).map((issue) => issue.id),
    [scoped],
  );
  const ensureBoardRootsExpandedOnce = useIssueUiStore(
    (s) => s.ensureBoardRootsExpandedOnce,
  );
  useLayoutEffect(() => {
    ensureBoardRootsExpandedOnce(boardRootIds);
  }, [boardRootIds, ensureBoardRootsExpandedOnce]);
  const hasStructureContent =
    nodes.length > 0 || ideaNodes.length > 0 || doneNodes.length > 0;

  const clearFilters = () => {
    setSearch("");
    setLabelFilter([]);
    setBoardKindFilter([]);
  };

  return (
    <div className="flex flex-col gap-6">
      {filtersOn && !hasStructureContent ? (
        <ShellState
          eyebrow="Filtered"
          title="No work matches these filters."
          detail="Clear search, labels, or kind to see the Structure again."
          action={
            <Button size="sm" variant="primary" onClick={clearFilters}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <IssueTree
          nodes={nodes}
          ideaNodes={ideaNodes}
          doneNodes={doneNodes}
          derived={viewDerived}
          issues={scoped}
          catalog={catalog}
          projectId={projectId}
        />
      )}
    </div>
  );
}
