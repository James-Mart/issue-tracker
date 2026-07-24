import { useMemo } from "react";
import { GitBranch, Plus } from "lucide-react";
import { useParams, useSearchParams } from "react-router-dom";
import { visibleIssues } from "@server/services/archived-visibility";
import type {
  DerivedState,
  IssueRecord,
  ProjectLabel,
} from "@server/schemas";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { IssuesQueryShell, ShellState } from "@/app/shell-state";
import { cn } from "@/lib/utils/cn";
import { useIssuesQuery } from "../api/queries";
import { issuesById } from "../lib/build-tree";
import {
  filterFlowBuckets,
  flowBuckets,
  flowFiltersActive,
  inFlightTaskOf,
  type FlowFilters,
  type FlowItem,
} from "../lib/flow";
import { issuePath } from "../lib/links";
import {
  OVERVIEW_LENS_OPTIONS,
  parseOverviewLens,
  writeOverviewLensParam,
  type OverviewLens,
} from "../lib/overview-lens";
import {
  structureScopedIssues,
  structureTreeNodes,
} from "../lib/structure";
import { useIssueUiStore } from "../store/use-issue-ui-store";
import { FlowBucketsSections } from "./flow-buckets-sections";
import { FlowRow } from "./flow-row";
import { FlowRowActions } from "./flow-row-actions";
import { IssueTree } from "./issue-tree";
import { OverviewFlowFilters } from "./overview-flow-filters";
import { OverviewDependenciesLens } from "./overview-dependencies-lens";
import { StructureIdeaCapture } from "./structure-idea-capture";

function OverviewHeader({ title }: { title: string }) {
  return (
    <header className="flex items-center gap-2">
      <SidebarTrigger className="-ml-1" />
      <div className="min-w-0">
        <p className="font-display text-[11px] font-semibold uppercase tracking-[0.22em] text-[hsl(var(--current))]">
          Overview
        </p>
        <h1 className="truncate text-base font-semibold tracking-tight text-foreground">
          {title}
        </h1>
      </div>
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

function flowBucketsEmpty(buckets: {
  ready: unknown[];
  inFlight: unknown[];
  blocked: unknown[];
  recentlyMerged: unknown[];
}): boolean {
  return (
    buckets.ready.length === 0 &&
    buckets.inFlight.length === 0 &&
    buckets.blocked.length === 0 &&
    buckets.recentlyMerged.length === 0
  );
}

/** Project-scoped Flow lens with search / label / kind / archived filters. */
function OverviewFlowLens({
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

  const visible = useMemo(
    () => visibleIssues(issues, showArchived),
    [issues, showArchived],
  );
  const byId = useMemo(() => issuesById(visible), [visible]);

  const buckets = useMemo(() => {
    const raw = flowBuckets(visible, derived, { projectId });
    return filterFlowBuckets(raw, visible, filters);
  }, [derived, filters, projectId, visible]);

  const clearFilters = () => {
    setSearch("");
    setLabelFilter([]);
    setBoardKindFilter("both");
  };

  return (
    <div
      role="tabpanel"
      id="overview-lens-panel-flow"
      aria-labelledby="overview-lens-tab-flow"
      className="flex flex-col gap-6"
    >
      <OverviewFlowFilters catalog={catalog} />

      {filtersOn && flowBucketsEmpty(buckets) ? (
        <ShellState
          eyebrow="Filtered"
          title="No work matches these filters."
          detail="Clear search, labels, or kind to see the Flow again."
          action={
            <Button size="sm" variant="primary" onClick={clearFilters}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <FlowBucketsSections
          buckets={buckets}
          idPrefix="overview-flow"
          renderRow={(item: FlowItem) => (
            <FlowRow
              item={item}
              to={issuePath(projectId, item.issue.id)}
              actions={
                <FlowRowActions
                  item={item}
                  projectId={projectId}
                  task={inFlightTaskOf(item.issue, visible, byId)}
                />
              }
            />
          )}
        />
      )}
    </div>
  );
}

/** Project-scoped Structure lens: containment tree + authoring create entry points. */
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
  const openNew = useIssueUiStore((s) => s.openNew);
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

  const clearFilters = () => {
    setSearch("");
    setLabelFilter([]);
    setBoardKindFilter("both");
  };

  const hasIdeas = useMemo(
    () => scoped.some((issue) => issue.kind === "idea"),
    [scoped],
  );

  return (
    <div
      role="tabpanel"
      id="overview-lens-panel-structure"
      aria-labelledby="overview-lens-tab-structure"
      className="flex flex-col gap-6"
    >
      <StructureIdeaCapture projectId={projectId} empty={!hasIdeas} />

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            openNew({ presetKind: "story", presetParent: projectId })
          }
        >
          <GitBranch className="h-4 w-4" />
          New story
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            openNew({ presetKind: "epic", presetParent: projectId })
          }
        >
          <Plus className="h-4 w-4" />
          New epic
        </Button>
      </div>

      <OverviewFlowFilters catalog={catalog} />

      {filtersOn && nodes.length === 0 ? (
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
          derived={derived}
          issues={scoped}
          catalog={catalog}
          projectId={projectId}
        />
      )}
    </div>
  );
}

/** Per-project overview shell: lens switcher (`?lens=`) + Flow / Structure / Dependencies lenses. */
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
              <span className="font-mono text-xs">
                {projectId || "(empty)"}
              </span>
            }
          />
        </PageShell>
      ) : (
        <PageShell>
          <OverviewHeader title={project.title} />
          <LensSwitcher value={lens} onChange={setLens} />

          {lens === "flow" ? (
            <OverviewFlowLens
              projectId={projectId}
              issues={issues}
              derived={derived}
              catalog={catalog}
            />
          ) : null}

          {lens === "structure" ? (
            <OverviewStructureLens
              projectId={projectId}
              issues={issues}
              derived={derived}
              catalog={catalog}
            />
          ) : null}

          {lens === "dependencies" ? (
            <OverviewDependenciesLens
              projectId={projectId}
              issues={issues}
              derived={derived}
            />
          ) : null}
        </PageShell>
      )}
    </IssuesQueryShell>
  );
}
