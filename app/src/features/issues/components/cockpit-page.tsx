import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Bot, Plus } from "lucide-react";
import type { IssueRecord } from "@server/schemas";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { IssuesQueryShell, ShellState } from "@/app/shell-state";
import { useIssuesQuery } from "../api/queries";
import { issuesById, listProjects, projectIdOf } from "../lib/build-tree";
import { flowBuckets, type FlowItem } from "../lib/flow";
import { issuePath, projectPath } from "../lib/links";
import { useIssueUiStore } from "../store/use-issue-ui-store";
import { FlowBucketsSections } from "./flow-buckets-sections";
import { FlowRow } from "./flow-row";

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

function CockpitFlowRow({
  item,
  issues,
  projectId,
  projectTitle,
}: {
  item: FlowItem;
  issues: IssueRecord[];
  projectId: string;
  projectTitle: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="min-w-0 flex-1">
        <FlowRow item={item} issues={issues} to={issuePath(projectId, item.issue.id)} />
      </div>
      <Link
        to={projectPath(projectId)}
        className="shrink-0 truncate font-mono text-[11px] text-muted-foreground hover:text-foreground"
        title={projectTitle}
      >
        {projectTitle}
      </Link>
    </div>
  );
}

export function CockpitPage() {
  const { data, isLoading, error, refetch, isFetching } = useIssuesQuery();
  const openProjectDialog = useIssueUiStore((s) => s.openProjectDialog);

  const issues = data?.issues ?? [];
  const derived = data?.derived ?? {};
  const byId = useMemo(() => issuesById(issues), [issues]);
  const projects = useMemo(() => listProjects(issues), [issues]);
  const buckets = useMemo(
    () => flowBuckets(issues, derived, {}),
    [derived, issues],
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
            variant="cockpit"
            renderRow={(item) => {
              const projectId = projectIdOf(item.issue.id, byId);
              if (!projectId) return null;
              const project = byId.get(projectId);
              const projectTitle =
                project?.kind === "project" ? project.title : projectId;
              return (
                <CockpitFlowRow
                  item={item}
                  issues={issues}
                  projectId={projectId}
                  projectTitle={projectTitle}
                />
              );
            }}
          />
        )}
      </PageShell>
    </IssuesQueryShell>
  );
}
