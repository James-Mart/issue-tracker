import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import type { IssueRecord } from "@server/schemas";
import { visibleIssues } from "@server/services/archived-visibility";
import { cn } from "@/lib/utils/cn";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
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
  issuesById,
  listProjects,
  projectIdOf,
  type ProjectRecord,
} from "../lib/build-tree";
import { flowBuckets, type FlowItem } from "../lib/flow";
import { issuePath, projectPath } from "../lib/links";
import { useIssueUiStore } from "../store/use-issue-ui-store";
import {
  FlowBucketsSections,
  FlowPreviewedItems,
  type FlowBucketKey,
} from "./flow-buckets-sections";
import type { ImplementingLockRefusal } from "../lib/implementing-launch";
import { ImplementingLockRefusalState } from "./implementing-launch-control";
import { FlowRow } from "./flow-row";
import { FlowRowActions } from "./flow-row-actions";

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
    .map(([projectId, groupItems]) => {
      const project = byId.get(projectId);
      const projectTitle =
        project?.kind === "project" ? project.title : projectId;
      return { projectId, projectTitle, items: groupItems };
    });
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

type CockpitImplementingLockRefusal = {
  projectId: string;
  refusal: ImplementingLockRefusal;
};

export function CockpitPage() {
  const { data, isLoading, error, refetch, isFetching } = useIssuesQuery();
  const openProjectDialog = useIssueUiStore((s) => s.openProjectDialog);
  const [hiddenIds, setHiddenIds] = useState(() => readCockpitHiddenProjectIds());
  const [collapsedSectionKeys, setCollapsedSectionKeys] = useState(
    () => readCockpitCollapsedSectionKeys(),
  );
  const [implementingLockRefusal, setImplementingLockRefusal] = useState<
    CockpitImplementingLockRefusal | undefined
  >();

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
  const byId = useMemo(() => issuesById(issues), [issues]);
  const projects = useMemo(() => listProjects(issues), [issues]);
  const projectOrder = useMemo(() => projects.map((project) => project.id), [projects]);
  const buckets = useMemo(() => {
    const visible = visibleIssues(issues, false);
    const hidden = new Set(hiddenIds);
    const filtered =
      hidden.size === 0
        ? visible
        : visible.filter((issue) => {
            const projectId = projectIdOf(issue.id, byId);
            return !projectId || !hidden.has(projectId);
          });
    return flowBuckets(filtered, derived, {});
  }, [byId, derived, hiddenIds, issues]);
  const allProjectsHidden =
    projects.length > 0 &&
    projects.every((project) => hiddenIds.includes(project.id));

  const renderBucketItems = useCallback(
    (items: FlowItem[], compact?: boolean, previewLimit?: number) => {
      const groups = groupFlowItemsByProject(items, byId, projectOrder);
      return (
        <div className={cn("flex flex-col", compact ? "gap-2" : "gap-3")}>
          {groups.map((group) => (
            <div key={group.projectId}>
              <CockpitProjectSubheader
                projectId={group.projectId}
                projectTitle={group.projectTitle}
              />
              <FlowPreviewedItems
                items={group.items}
                previewLimit={previewLimit}
                asRail
                listClassName={compact ? "mt-1 gap-1" : "mt-1.5 gap-1"}
                renderItem={(item) => (
                  <FlowRow
                    item={item}
                    issues={issues}
                    to={issuePath(group.projectId, item.issue.id)}
                    drillInState={{
                      issueBackStack: [{ kind: "cockpit" }],
                    }}
                    actions={
                      <FlowRowActions
                        item={item}
                        onImplementingLockRefusal={(refusal) =>
                          setImplementingLockRefusal({
                            projectId: group.projectId,
                            refusal,
                          })
                        }
                      />
                    }
                  />
                )}
              />
            </div>
          ))}
        </div>
      );
    },
    [byId, issues, projectOrder],
  );

  return (
    <IssuesQueryShell
      isLoading={isLoading}
      error={error}
      isFetching={isFetching}
      onReload={() => void refetch()}
      loadingLabel="Loading the line…"
      errorTitle="Couldn't load the line."
    >
      <PageShell>
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
        ) : implementingLockRefusal ? (
          <ImplementingLockRefusalState
            projectId={implementingLockRefusal.projectId}
            refusal={implementingLockRefusal.refusal}
          />
        ) : (
          <FlowBucketsSections
            buckets={buckets}
            idPrefix="cockpit"
            renderItems={renderBucketItems}
            collapsedSectionKeys={collapsedSectionKeys}
            onToggleSection={onToggleSection}
          />
        )}
      </PageShell>
    </IssuesQueryShell>
  );
}
