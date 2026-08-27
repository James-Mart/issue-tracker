import { useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { Bot, Plus } from "lucide-react";
import type { IssueRecord } from "@server/schemas";
import { visibleIssues } from "@server/services/archived-visibility";
import { cn } from "@/lib/utils/cn";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { IssuesQueryShell, ShellState } from "@/app/shell-state";
import { useIssuesQuery } from "../api/queries";
import { issuesById, listProjects, projectIdOf } from "../lib/build-tree";
import { flowBuckets, type FlowItem } from "../lib/flow";
import { issuePath, projectPath } from "../lib/links";
import { useIssueUiStore } from "../store/use-issue-ui-store";
import {
  FlowBucketsSections,
  FlowPreviewedItems,
} from "./flow-buckets-sections";
import { FlowRow } from "./flow-row";
import { FlowRowActions } from "./flow-row-actions";

function CockpitHeader() {
  return (
    <header className="flex items-center justify-between gap-2">
      <p className="min-w-0 font-display text-[11px] font-semibold uppercase tracking-[0.22em] text-[hsl(var(--current))]">
        Cockpit
      </p>
      <Link
        to="/agents"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-[hsl(var(--rail-lit))] hover:text-foreground"
      >
        <Bot className="h-3.5 w-3.5" />
        Agents
      </Link>
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

export function CockpitPage() {
  const { data, isLoading, error, refetch, isFetching } = useIssuesQuery();
  const openProjectDialog = useIssueUiStore((s) => s.openProjectDialog);

  const issues = data?.issues ?? [];
  const derived = data?.derived ?? {};
  const byId = useMemo(() => issuesById(issues), [issues]);
  const projects = useMemo(() => listProjects(issues), [issues]);
  const projectOrder = useMemo(() => projects.map((project) => project.id), [projects]);
  const buckets = useMemo(
    () => flowBuckets(visibleIssues(issues, false), derived, {}),
    [derived, issues],
  );

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
                listClassName={compact ? "mt-1 gap-1" : "mt-1.5 gap-1"}
                renderItem={(item) => (
                  <FlowRow
                    item={item}
                    issues={issues}
                    to={issuePath(group.projectId, item.issue.id)}
                    actions={<FlowRowActions item={item} />}
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
        <CockpitHeader />
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
        ) : (
          <FlowBucketsSections
            buckets={buckets}
            idPrefix="cockpit"
            renderItems={renderBucketItems}
          />
        )}
      </PageShell>
    </IssuesQueryShell>
  );
}
