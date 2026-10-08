import { useLayoutEffect, useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { ProjectLabel } from "@server/schemas";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import {
  IssuesQueryShell,
  ShellFaultDetail,
  ShellInlineFault,
  ShellLoadingState,
  ShellState,
} from "@/app/shell-state";
import { useUploadAttachment } from "../api/mutations";
import { useIssueDetailQuery, useIssuesQuery } from "../api/queries";
import { useIssuesIncludingArchived } from "../hooks/use-issues-with-archived";
import {
  type FlowFilters,
  flowFiltersActive,
} from "../lib/flow";
import { parseOverviewLens } from "../lib/overview-lens";
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
import { ProjectLensSwitcher } from "./project-lens-switcher";
import { ProjectSettingsOverview } from "./project-settings-overview";

function OverviewHeader({ title }: { title: string }) {
  return (
    <header>
      <p className="font-display text-[11px] font-semibold uppercase tracking-[0.22em] text-[hsl(var(--current))]">
        Overview
      </p>
      <h1 className="truncate text-base font-semibold tracking-tight text-foreground">
        {title}
      </h1>
    </header>
  );
}

/** Project-scoped Overview lens: the Project issue's own detail content. */
function OverviewProjectLens({ projectId }: { projectId: string }) {
  const { data: issue, isLoading, error } = useIssueDetailQuery(projectId);
  const upload = useUploadAttachment(projectId);

  return (
    <div className="flex flex-col gap-6">
      {isLoading && !issue ? (
        <ShellLoadingState label="Loading project…" />
      ) : null}

      {error ? (
        <ShellInlineFault
          message={error.message}
          hint="Check the server, then reload."
        />
      ) : null}

      {issue?.kind === "project" ? (
        <ProjectSettingsOverview issue={issue} upload={upload} />
      ) : null}
    </div>
  );
}

/** Project-scoped Structure lens content (shared toolbar lives on OverviewPage). */
function OverviewStructureLens({
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

/** Per-project overview shell: shared toolbar + Structure / Overview lenses (`?lens=`). */
export function OverviewPage() {
  const { projectId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const lens = parseOverviewLens(searchParams.get("lens"));
  const { data, isLoading, error, refetch, isFetching } = useIssuesQuery();

  const issues = data?.issues ?? [];
  const project = useMemo(
    () =>
      issues.find(
        (issue) => issue.id === projectId && issue.kind === "project",
      ),
    [issues, projectId],
  );
  const catalog = project?.kind === "project" ? (project.labels ?? []) : [];

  return (
    <IssuesQueryShell
      isLoading={isLoading}
      error={error}
      isFetching={isFetching}
      onReload={() => void refetch()}
      loadingLabel="Loading overview…"
      errorTitle="Couldn't load the overview."
    >
      {!project ? (
        <PageShell>
          <OverviewHeader title="Project not found" />
          <ShellState
            tone="blocked"
            eyebrow="Missing"
            title="No project with that id."
            detail={
              <ShellFaultDetail
                message={projectId || "(no id in the URL)"}
                hint="It may have been renamed or deleted. Pick a project from the Cockpit."
              />
            }
            action={
              <Button asChild size="sm" variant="primary">
                <Link to="/">Back to Cockpit</Link>
              </Button>
            }
          />
        </PageShell>
      ) : (
        <PageShell>
          <OverviewHeader title={project.title} />
          <ProjectLensSwitcher projectId={projectId} active={lens} />
          {lens === "structure" ? (
            <OverviewFlowFilters projectId={projectId} catalog={catalog} />
          ) : null}

          {lens === "structure" ? (
            <OverviewStructureLens projectId={projectId} catalog={catalog} />
          ) : null}

          {lens === "overview" ? (
            <OverviewProjectLens projectId={projectId} />
          ) : null}
        </PageShell>
      )}
    </IssuesQueryShell>
  );
}
