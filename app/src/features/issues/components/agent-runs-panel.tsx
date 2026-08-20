import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import {
  ShellInlineFault,
  ShellLoadingState,
  ShellState,
} from "@/app/shell-state";
import { toolStatusVariant } from "@/features/agents/components/transcript-ui";
import { cn } from "@/lib/utils/cn";
import type { AgentRun } from "@server/schemas";
import type { IssueAgentRunsWorkRoot } from "../api/agent-runs";
import { useIssueAgentRunsQuery } from "../api/queries";
import { issueChannelPath } from "../lib/links";

function formatRunStartTime(startedAt: string): string {
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) return startedAt;
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRunDurationMs(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem > 0 ? `${min}m ${rem}s` : `${min}m`;
}

function runDuration(run: AgentRun): string | null {
  if (!run.endedAt) return null;
  const start = new Date(run.startedAt).getTime();
  const end = new Date(run.endedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return formatRunDurationMs(end - start);
}

function AgentRunsCoordinatorLink({
  projectId,
  workRoot,
}: {
  projectId: string;
  workRoot: IssueAgentRunsWorkRoot;
}) {
  return (
    <p className="text-sm text-muted-foreground">
      <Link
        to={issueChannelPath(projectId, workRoot.issueId, "implementing")}
        className="font-medium text-foreground underline underline-offset-2 hover:text-[hsl(var(--current))]"
        data-testid="agent-runs-coordinator-link"
      >
        Open coordinator conversation
      </Link>
    </p>
  );
}

/** At-rest run card — header only; expansion arrives in a later Story. */
export function AgentRunCard({ run }: { run: AgentRun }) {
  const running = run.status === "running";
  const duration = runDuration(run);

  return (
    <div
      className="min-w-0 overflow-hidden rounded-lg border border-border bg-card"
      data-run-id={run.delegationId}
      data-status={run.status}
    >
      <div className="flex min-h-11 min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 border-l-2 border-l-[hsl(var(--current))] px-3 py-2.5 font-mono text-[11px] text-muted-foreground">
        <Badge
          variant={toolStatusVariant(run.status)}
          className={cn("shrink-0 text-[10px]", running && "animate-pulse")}
          data-status-indicator={run.status}
        >
          {run.status}
        </Badge>
        <span className="shrink-0 text-xs font-medium text-foreground">
          {run.role}
        </span>
        <span className="min-w-0 truncate text-[11px]">{run.model}</span>
        <span
          className="shrink-0 tabular-nums text-[hsl(var(--mut))]"
          data-started-at={run.startedAt}
        >
          {formatRunStartTime(run.startedAt)}
        </span>
        {duration ? (
          <span
            className="shrink-0 tabular-nums text-[hsl(var(--mut))]"
            data-duration={duration}
          >
            {duration}
          </span>
        ) : null}
        {run.isResume ? (
          <span
            className="shrink-0 text-[10px] uppercase tracking-[0.1em] text-[hsl(var(--current))]"
            data-resume-marker=""
          >
            Resume
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function AgentRunsPanel({
  issueId,
  projectId,
}: {
  issueId: string;
  projectId: string;
}) {
  const { data, isLoading, error } = useIssueAgentRunsQuery(issueId);

  if (isLoading) {
    return <ShellLoadingState label="Loading agent runs…" />;
  }

  if (error) {
    return (
      <ShellInlineFault
        message={error.message}
        hint="Reload the page or try again in a moment."
      />
    );
  }

  const runs = data?.runs ?? [];
  const workRoot = data?.workRoot;
  const coordinatorLink =
    workRoot != null ? (
      <AgentRunsCoordinatorLink projectId={projectId} workRoot={workRoot} />
    ) : null;

  if (runs.length === 0) {
    return (
      <div data-slot="agent-runs-panel" data-testid="agent-runs-empty-state">
        <ShellState
          className="border-0 bg-transparent px-4 py-8 shadow-none"
          eyebrow="Agents"
          title="No agent has run against this issue yet."
          detail={coordinatorLink}
        />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2" data-slot="agent-runs-panel">
      {coordinatorLink}
      {runs.map((run) => (
        <AgentRunCard key={run.delegationId} run={run} />
      ))}
    </div>
  );
}
