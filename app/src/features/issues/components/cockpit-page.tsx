import { useCallback, useMemo, useState, type HTMLAttributes, type ReactNode } from "react";
import { useTabTitle } from "@/lib/tab-title/use-tab-title";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import type { DerivedState, IssueRecord } from "@server/schemas";
import { outlineIssues } from "@server/services/archived-visibility";
import { cn } from "@/lib/utils/cn";
import { COCKPIT_COLUMN_CLASS, PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { RailNode, type RailSpine } from "@/components/ui/rail";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IssuesQueryShell, ShellState } from "@/app/shell-state";
import { useIssuesQuery } from "../api/queries";
import {
  readCockpitCollapsedSectionKeys,
  toggleCockpitCollapsedSectionKey,
  writeCockpitCollapsedSectionKeys,
} from "../lib/cockpit-collapsed-sections";
import {
  readCockpitHiddenProjectIds,
  toggleCockpitHiddenProjectId,
  writeCockpitHiddenProjectIds,
} from "../lib/cockpit-hidden-projects";
import {
  listProjects,
  projectIdOf,
  type ProjectRecord,
} from "../lib/build-tree";
import {
  buildTreeRowIndexes,
  type TreeRowIndexes,
} from "../lib/tree-row-indexes";
import {
  flowBuckets,
  flowRowIsLive,
  type FlowBuckets,
  type FlowItem,
} from "../lib/flow";
import { issueRailNodeState } from "../lib/rail-state";
import {
  groupSectionRows,
  type SectionGroup,
} from "../lib/group-section-rows";
import { issuePath, projectPath } from "../lib/links";
import {
  cockpitLaunchFaultMessage,
  overlayCockpitLaunchAck,
} from "../lib/cockpit-launch-sync";
import {
  useCockpitLaunchIssuesSync,
  useCockpitLaunchStore,
} from "../store/use-cockpit-launch-store";
import { useIssueUiStore } from "../store/use-issue-ui-store";
import {
  FlowBucketsSections,
  FLOW_BUCKET_DEFS,
  FlowPreviewedItems,
  partitionCockpitBuckets,
  type FlowBucketKey,
} from "./flow-buckets-sections";
import { FlowRow } from "./flow-row";
import { FlowRowActions } from "./flow-row-actions";
import type { QueueRowChrome } from "../lib/queue-reorder";
import { QueueBucketRow, QueueReorderProvider } from "./queue-reorder";

const COCKPIT_MAIN_SECTION_KEYS: FlowBucketKey[] = FLOW_BUCKET_DEFS.map(
  (def) => def.key,
).filter((key) => key !== "queue");

/** True when the non-queue cockpit column has a section to show. */
function cockpitMainHasRows(buckets: FlowBuckets): boolean {
  const { needsAttention, buckets: rest } = partitionCockpitBuckets(buckets);
  if (needsAttention.length > 0) return true;
  const mainKeys = COCKPIT_MAIN_SECTION_KEYS.filter(
    (key): key is keyof FlowBuckets => key !== "needsAttention",
  );
  if (mainKeys.some((key) => rest[key].length > 0)) return true;
  // Ready still renders its empty hint when unqueued blocked roots exist.
  return buckets.blocked.length > 0;
}

function CockpitHeader({
  projects,
  hiddenIds,
  onHiddenIdsChange,
}: {
  projects: ProjectRecord[];
  hiddenIds: string[];
  onHiddenIdsChange: (ids: string[]) => void;
}) {
  const hiddenCount = hiddenIds.length;
  const filterActive = hiddenCount > 0;

  return (
    <header className="flex items-center justify-between gap-2">
      <p className="min-w-0 font-display text-[11px] font-semibold uppercase tracking-[0.22em] text-[hsl(var(--current))]">
        Cockpit
      </p>
      <div className="flex shrink-0 items-center gap-2">
        {projects.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant={filterActive ? "secondary" : "outline"}
                size="sm"
                className="shrink-0"
                aria-label="Projects"
                title="Projects"
              >
                Projects
                {hiddenCount > 0 ? (
                  <span className="ml-1 tabular-nums text-muted-foreground">
                    ({hiddenCount})
                  </span>
                ) : null}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Projects in Cockpit</DropdownMenuLabel>
              {projects.map((project) => (
                <DropdownMenuCheckboxItem
                  key={project.id}
                  checked={!hiddenIds.includes(project.id)}
                  onCheckedChange={() =>
                    onHiddenIdsChange(
                      toggleCockpitHiddenProjectId(hiddenIds, project.id),
                    )
                  }
                  onSelect={(event) => event.preventDefault()}
                >
                  {project.title}
                </DropdownMenuCheckboxItem>
              ))}
              {filterActive ? (
                <DropdownMenuItem onSelect={() => onHiddenIdsChange([])}>
                  Show all
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </header>
  );
}

type ProjectFlowGroup = {
  projectId: string;
  projectTitle: string;
  items: FlowItem[];
};

const SECTION_SCOPED_BUCKETS: ReadonlySet<FlowBucketKey> = new Set([
  "readyToLand",
  "needsAttention",
]);

/** Title node that opens the epic. The group stays expanded. */
function EpicGroupTitle({
  projectId,
  epicId,
  title,
}: {
  projectId: string;
  epicId: string;
  title: string;
}) {
  return (
    <RailNode state="ready" edge="solid" className="items-start py-1">
      <Link
        to={issuePath(projectId, epicId)}
        state={{ issueBackStack: [{ kind: "cockpit" }] }}
        data-testid="epic-group-title"
        title={title}
        className="min-w-0 max-w-full truncate text-[13px] font-medium text-foreground hover:underline"
      >
        {title}
      </Link>
    </RailNode>
  );
}

function CockpitFlowRail({
  items,
  indexes,
  issues,
  derived,
  previewLimit,
  projectId,
  compact,
  queue,
  spine,
  leading,
  railProps,
  listClassName,
  flowRow,
}: {
  items: FlowItem[];
  indexes: TreeRowIndexes;
  issues: IssueRecord[];
  derived: Record<string, DerivedState>;
  previewLimit?: number;
  projectId: string;
  compact?: boolean;
  queue?: boolean;
  spine?: RailSpine;
  leading?: ReactNode;
  railProps?: Omit<HTMLAttributes<HTMLDivElement>, "className" | "style">;
  listClassName?: string;
  flowRow: (
    item: FlowItem,
    projectId: string,
    projectTitle?: string,
    queueChrome?: QueueRowChrome,
  ) => ReactNode;
}) {
  return (
    <FlowPreviewedItems
      items={items}
      indexes={indexes}
      previewLimit={previewLimit}
      asRail
      spine={spine}
      leading={leading}
      railProps={railProps}
      liveItem={(item) =>
        flowRowIsLive(
          item,
          item.queueStage,
          issueRailNodeState(item.issue, item.state, indexes),
          issues,
          derived,
        )
      }
      listClassName={listClassName ?? (compact ? "mt-1 gap-1" : "mt-1.5 gap-1")}
      renderItem={(item) =>
        queue ? (
          <QueueBucketRow item={item} projectId={projectId} render={flowRow} />
        ) : (
          flowRow(item, projectId)
        )
      }
    />
  );
}

function sectionGroupKey(sectionGroup: SectionGroup): string {
  if (sectionGroup.head.kind === "none") {
    return `none:${sectionGroup.items[0].issue.id}`;
  }
  return `${sectionGroup.head.kind}:${sectionGroup.head.epicId}`;
}

function CockpitSectionGroupRail({
  sectionGroup,
  projectId,
  byId,
  indexes,
  issues,
  derived,
  previewLimit,
  flowRow,
}: {
  sectionGroup: SectionGroup;
  projectId: string;
  byId: Map<string, IssueRecord>;
  indexes: TreeRowIndexes;
  issues: IssueRecord[];
  derived: Record<string, DerivedState>;
  previewLimit?: number;
  flowRow: (
    item: FlowItem,
    projectId: string,
    projectTitle?: string,
    queueChrome?: QueueRowChrome,
  ) => ReactNode;
}) {
  const head = sectionGroup.head;
  const epicId = head.kind === "none" ? undefined : head.epicId;
  return (
    <CockpitFlowRail
      items={sectionGroup.items}
      indexes={indexes}
      issues={issues}
      derived={derived}
      previewLimit={previewLimit}
      projectId={projectId}
      flowRow={flowRow}
      spine={head.kind === "none" ? "inset" : "ports"}
      listClassName="gap-1"
      leading={
        head.kind === "title" ? (
          <EpicGroupTitle
            projectId={projectId}
            epicId={head.epicId}
            title={epicHeadingTitle(byId, head.epicId)}
          />
        ) : undefined
      }
      railProps={{
        "data-epic-group": head.kind,
        ...(epicId != null ? { "data-epic-id": epicId } : null),
      }}
    />
  );
}

function epicHeadingTitle(
  byId: Map<string, IssueRecord>,
  epicId: string,
): string {
  const epic = byId.get(epicId);
  if (epic?.kind !== "epic") {
    throw new Error(`Cockpit epic heading ${epicId} is missing`);
  }
  return epic.title;
}

/** Display name for a cockpit project id. */
export function cockpitProjectTitle(
  projectId: string,
  byId: Map<string, IssueRecord>,
): string {
  const project = byId.get(projectId);
  return project?.kind === "project" ? project.title : projectId;
}

/** Group bucket rows by project; project order follows the global project list. */
export function groupFlowItemsByProject(
  items: FlowItem[],
  byId: Map<string, IssueRecord>,
  projectOrder: string[],
): ProjectFlowGroup[] {
  const groups = new Map<string, FlowItem[]>();
  for (const item of items) {
    const projectId = projectIdOf(item.issue.id, byId);
    if (!projectId) continue;
    const bucket = groups.get(projectId) ?? [];
    bucket.push(item);
    groups.set(projectId, bucket);
  }

  const orderIndex = new Map(projectOrder.map((id, index) => [id, index]));
  return [...groups.entries()]
    .sort(
      ([leftId], [rightId]) =>
        (orderIndex.get(leftId) ?? Number.MAX_SAFE_INTEGER) -
        (orderIndex.get(rightId) ?? Number.MAX_SAFE_INTEGER),
    )
    .map(([projectId, groupItems]) => ({
      projectId,
      projectTitle: cockpitProjectTitle(projectId, byId),
      items: groupItems,
    }));
}

function CockpitProjectSubheader({
  projectId,
  projectTitle,
}: {
  projectId: string;
  projectTitle: string;
}) {
  return (
    <h3 className="truncate font-mono text-[11px] font-normal text-muted-foreground">
      <Link
        to={projectPath(projectId)}
        className="hover:text-foreground"
        title={projectTitle}
      >
        {projectTitle}
      </Link>
    </h3>
  );
}

export function CockpitPage() {
  useTabTitle("Cockpit");
  const { data, isLoading, error, refetch, isFetching } = useIssuesQuery();
  const openProjectDialog = useIssueUiStore((s) => s.openProjectDialog);
  const [hiddenIds, setHiddenIds] = useState(() => readCockpitHiddenProjectIds());
  const [collapsedSectionKeys, setCollapsedSectionKeys] = useState(
    () => readCockpitCollapsedSectionKeys(),
  );
  const setHiddenIdsAndCookie = useCallback((ids: string[]) => {
    writeCockpitHiddenProjectIds(ids);
    setHiddenIds(ids);
  }, []);

  const onToggleSection = useCallback((key: FlowBucketKey) => {
    setCollapsedSectionKeys((prev) => {
      const next = toggleCockpitCollapsedSectionKey(prev, key);
      writeCockpitCollapsedSectionKeys(next);
      return next;
    });
  }, []);

  const issues = data?.issues ?? [];
  const derived = data?.derived ?? {};
  const ack = useCockpitLaunchStore((s) => s.ack);
  const fault = useCockpitLaunchStore((s) => s.fault);
  useCockpitLaunchIssuesSync(data?.derived);
  const derivedForBuckets = useMemo(
    () => (ack ? overlayCockpitLaunchAck(derived, issues, ack) : derived),
    [ack, derived, issues],
  );
  const indexes = useMemo(() => buildTreeRowIndexes(issues), [issues]);
  const byId = indexes.byId;
  const projects = useMemo(() => listProjects(issues), [issues]);
  const projectOrder = useMemo(() => projects.map((project) => project.id), [projects]);
  const buckets = useMemo(() => {
    const visible = outlineIssues(issues, false);
    const hidden = new Set(hiddenIds);
    const filtered =
      hidden.size === 0
        ? visible
        : visible.filter((issue) => {
            const projectId = projectIdOf(issue.id, byId);
            return !projectId || !hidden.has(projectId);
          });
    return flowBuckets(filtered, derivedForBuckets, {});
  }, [byId, derivedForBuckets, hiddenIds, issues]);
  const allProjectsHidden =
    projects.length > 0 &&
    projects.every((project) => hiddenIds.includes(project.id));

  const flowRow = useCallback(
    (
      item: FlowItem,
      projectId: string,
      projectTitle?: string,
      queueChrome?: QueueRowChrome,
    ) => (
      <FlowRow
        item={item}
        indexes={indexes}
        issues={issues}
        derived={derivedForBuckets}
        projectTitle={projectTitle}
        queueStage={item.queueStage}
        queueChrome={queueChrome}
        launchFault={
          fault?.issueId === item.issue.id
            ? cockpitLaunchFaultMessage(item.issue.title, fault.kind)
            : undefined
        }
        to={issuePath(projectId, item.issue.id)}
        drillInState={{
          issueBackStack: [{ kind: "cockpit" }],
        }}
        actions={
          <FlowRowActions
            item={item}
            issues={issues}
            derived={derivedForBuckets}
          />
        }
      />
    ),
    [derivedForBuckets, fault, indexes, issues],
  );

  const renderGroupedBucketItems = useCallback(
    (
      items: FlowItem[],
      compact?: boolean,
      previewLimit?: number,
      bucketKey?: FlowBucketKey,
    ) => {
      const queueBucket = bucketKey === "queue";
      const sectionScoped =
        bucketKey != null && SECTION_SCOPED_BUCKETS.has(bucketKey);
      const groups = groupFlowItemsByProject(items, byId, projectOrder);
      const list = (
        <div className={cn("flex flex-col", compact ? "gap-2" : "gap-3")}>
          {groups.map((group) => (
            <div key={group.projectId}>
              <CockpitProjectSubheader
                projectId={group.projectId}
                projectTitle={group.projectTitle}
              />
              {sectionScoped ? (
                <div
                  data-testid="cockpit-epic-groups"
                  className={cn(
                    "flex flex-col",
                    compact ? "mt-1 gap-3" : "mt-1.5 gap-4",
                  )}
                >
                  {groupSectionRows(group.items, byId).map((sectionGroup) => (
                    <CockpitSectionGroupRail
                      key={sectionGroupKey(sectionGroup)}
                      sectionGroup={sectionGroup}
                      projectId={group.projectId}
                      byId={byId}
                      indexes={indexes}
                      issues={issues}
                      derived={derivedForBuckets}
                      previewLimit={previewLimit}
                      flowRow={flowRow}
                    />
                  ))}
                </div>
              ) : (
                <CockpitFlowRail
                  items={group.items}
                  indexes={indexes}
                  issues={issues}
                  derived={derivedForBuckets}
                  previewLimit={previewLimit}
                  projectId={group.projectId}
                  compact={compact}
                  queue={queueBucket}
                  flowRow={flowRow}
                />
              )}
            </div>
          ))}
        </div>
      );
      if (!queueBucket) return list;
      return <QueueReorderProvider items={items}>{list}</QueueReorderProvider>;
    },
    [byId, derivedForBuckets, flowRow, indexes, issues, projectOrder],
  );

  const renderRecentlyMergedItems = useCallback(
    (items: FlowItem[], _compact?: boolean, previewLimit?: number) => (
      <FlowPreviewedItems
        items={items}
        indexes={indexes}
        previewLimit={previewLimit}
        asRail
        listClassName="gap-1.5"
        renderItem={(item) => {
          const projectId = projectIdOf(item.issue.id, byId);
          if (!projectId) return null;
          return flowRow(
            item,
            projectId,
            cockpitProjectTitle(projectId, byId),
          );
        }}
      />
    ),
    [byId, flowRow, indexes],
  );

  return (
    <IssuesQueryShell
      isLoading={isLoading}
      error={error}
      isFetching={isFetching}
      onReload={() => void refetch()}
      loadingLabel="Loading the line…"
      errorTitle="Couldn't load the line."
      columnClassName={COCKPIT_COLUMN_CLASS}
    >
      <PageShell>
        <div
          className={
            buckets.queue.length > 0 && cockpitMainHasRows(buckets)
              ? "mx-auto flex w-full min-w-0 max-w-[calc(2*var(--content-max)+2rem)] flex-col gap-5"
              : COCKPIT_COLUMN_CLASS
          }
        >
          <CockpitHeader
            projects={projects}
            hiddenIds={hiddenIds}
            onHiddenIdsChange={setHiddenIdsAndCookie}
          />
          {projects.length === 0 ? (
            <ShellState
              eyebrow="Empty"
              title="No projects on the line."
              detail="Create a project to start planning."
              action={
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => openProjectDialog()}
                >
                  <Plus className="h-4 w-4" />
                  New project
                </Button>
              }
            />
          ) : allProjectsHidden ? (
            <ShellState
              eyebrow="Filtered"
              title="No projects in view."
              detail="Every project is hidden from the Cockpit. Show them again to see work across the line."
              action={
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => setHiddenIdsAndCookie([])}
                >
                  Show all projects
                </Button>
              }
            />
          ) : buckets.queue.length > 0 && cockpitMainHasRows(buckets) ? (
            <div
              data-testid="cockpit-split"
              className="flex min-w-0 flex-col gap-5 shell:flex-row shell:items-start shell:gap-8"
            >
              <div
                data-testid="cockpit-queue-pane"
                className="min-w-0 w-full shell:order-2 shell:max-h-[calc(100svh-8rem)] shell:flex-1 shell:overflow-y-auto"
              >
                <FlowBucketsSections
                  buckets={buckets}
                  idPrefix="cockpit"
                  keys={["queue"]}
                  renderItems={renderGroupedBucketItems}
                  collapsedSectionKeys={collapsedSectionKeys}
                  onToggleSection={onToggleSection}
                />
              </div>
              <div
                data-testid="cockpit-main-pane"
                className="min-w-0 w-full shell:order-1 shell:max-h-[calc(100svh-8rem)] shell:flex-1 shell:overflow-y-auto"
              >
                <FlowBucketsSections
                  buckets={buckets}
                  idPrefix="cockpit"
                  keys={COCKPIT_MAIN_SECTION_KEYS}
                  renderItems={renderGroupedBucketItems}
                  renderRecentlyMergedItems={renderRecentlyMergedItems}
                  collapsedSectionKeys={collapsedSectionKeys}
                  onToggleSection={onToggleSection}
                />
              </div>
            </div>
          ) : (
            <FlowBucketsSections
              buckets={buckets}
              idPrefix="cockpit"
              renderItems={renderGroupedBucketItems}
              renderRecentlyMergedItems={renderRecentlyMergedItems}
              collapsedSectionKeys={collapsedSectionKeys}
              onToggleSection={onToggleSection}
            />
          )}
        </div>
      </PageShell>
    </IssuesQueryShell>
  );
}
