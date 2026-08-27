import { useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type {
  DerivedState,
  IssueRecord,
  ProjectLabel,
} from "@server/schemas";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import {
  IssuesQueryShell,
  ShellFaultDetail,
  ShellInlineFault,
  ShellLoadingState,
  ShellState,
} from "@/app/shell-state";
import { cn } from "@/lib/utils/cn";
import { useUploadAttachment } from "../api/mutations";
import { useIssueDetailQuery, useIssuesQuery } from "../api/queries";
import {
  type FlowFilters,
  flowFiltersActive,
} from "../lib/flow";
import {
  OVERVIEW_LENS_OPTIONS,
  parseOverviewLens,
  writeOverviewLensParam,
  type OverviewLens,
} from "../lib/overview-lens";
import {
  structureIdeaNodes,
  structureScopedIssues,
  structureTreeNodes,
} from "../lib/structure";
import { useIssueUiStore } from "../store/use-issue-ui-store";
import { IssueTree } from "./issue-tree";
import { OverviewFlowFilters } from "./overview-flow-filters";
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

function LensSwitcher({
  value,
  onChange,
}: {
  value: OverviewLens;
  onChange: (lens: OverviewLens) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Overview lens"
      className="flex flex-wrap items-center gap-0.5 rounded-md border border-border p-0.5"
    >
      {OVERVIEW_LENS_OPTIONS.map(({ id, label }) => {
        const selected = value === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={selected}
            id={`overview-lens-tab-${id}`}
            aria-controls={`overview-lens-panel-${id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(id)}
            className={cn(
              "rounded-[calc(var(--radius)-2px)] px-3 py-1.5 text-xs font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** Project-scoped Overview lens: the Project issue's own detail content. */
function OverviewProjectLens({ projectId }: { projectId: string }) {
  const { data: issue, isLoading, error } = useIssueDetailQuery(projectId);
  const upload = useUploadAttachment(projectId);

  return (
    <div
      role="tabpanel"
      id="overview-lens-panel-overview"
      aria-labelledby="overview-lens-tab-overview"
      className="flex flex-col gap-6"
    >
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
  issues,
  derived,
  catalog,
}: {
  projectId: string;
  issues: IssueRecord[];
  derived: Record<string, DerivedState>;
  catalog: ProjectLabel[];
}) {
  const search = useIssueUiStore((s) => s.search);
  const setSearch = useIssueUiStore((s) => s.setSearch);
  const labelFilter = useIssueUiStore((s) => s.labelFilter);
  const setLabelFilter = useIssueUiStore((s) => s.setLabelFilter);
  const boardKindFilter = useIssueUiStore((s) => s.boardKindFilter);
  const setBoardKindFilter = useIssueUiStore((s) => s.setBoardKindFilter);
  const showArchived = useIssueUiStore((s) => s.showArchived);

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
    () => structureScopedIssues(issues, projectId, showArchived),
    [issues, projectId, showArchived],
  );
  const nodes = useMemo(
    () => structureTreeNodes(scoped, filters),
    [filters, scoped],
  );
  const ideaNodes = useMemo(
    () => structureIdeaNodes(scoped, filters),
    [filters, scoped],
  );
  const hasStructureContent = nodes.length > 0 || ideaNodes.length > 0;

  const clearFilters = () => {
    setSearch("");
    setLabelFilter([]);
    setBoardKindFilter([]);
  };

  return (
    <div
      role="tabpanel"
      id="overview-lens-panel-structure"
      aria-labelledby="overview-lens-tab-structure"
      className="flex flex-col gap-6"
    >
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
          derived={derived}
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
  const [searchParams, setSearchParams] = useSearchParams();
  const lens = parseOverviewLens(searchParams.get("lens"));
  const { data, isLoading, error, refetch, isFetching } = useIssuesQuery();

  const issues = data?.issues ?? [];
  const derived = data?.derived ?? {};
  const project = useMemo(
    () =>
      issues.find(
        (issue) => issue.id === projectId && issue.kind === "project",
      ),
    [issues, projectId],
  );
  const catalog = project?.kind === "project" ? (project.labels ?? []) : [];

  const setLens = (next: OverviewLens) => {
    setSearchParams((prev) => writeOverviewLensParam(prev, next), {
      replace: true,
    });
  };

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
          <LensSwitcher value={lens} onChange={setLens} />
          {lens === "structure" ? (
            <OverviewFlowFilters projectId={projectId} catalog={catalog} />
          ) : null}

          {lens === "structure" ? (
            <OverviewStructureLens
              projectId={projectId}
              issues={issues}
              derived={derived}
              catalog={catalog}
            />
          ) : null}

          {lens === "overview" ? (
            <OverviewProjectLens projectId={projectId} />
          ) : null}
        </PageShell>
      )}
    </IssuesQueryShell>
  );
}
