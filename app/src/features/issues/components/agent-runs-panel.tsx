import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ShellInlineFault,
  ShellLoadingState,
  ShellState,
} from "@/app/shell-state";
import { applyNestedStep } from "@/features/agents/lib/subagent";
import { groupOrdinaryNestedToolCalls } from "@/features/agents/lib/transcript-rows";
import {
  indexedStreamKey,
  toolCallRowKey,
  toolStatusVariant,
  ToolUseGroup,
  TranscriptMarkdownText,
  TranscriptThinking,
  TranscriptToolCall,
} from "@/features/agents/components/transcript-ui";
import { cn } from "@/lib/utils/cn";
import type { AgentRun, NestedStep, TranscriptEvent } from "@server/schemas";
import type { IssueAgentRunsWorkRoot } from "../api/agent-runs";
import {
  useIssueAgentRunEventsQuery,
  useIssueAgentRunsQuery,
} from "../api/queries";
import { useWorkRootAgentRuns } from "../hooks/use-work-root-agent-runs";
import { issueChannelPath } from "../lib/links";

type SubagentUpdateEvent = Extract<TranscriptEvent, { type: "subagent_update" }>;

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

function nestedStepKey(step: NestedStep, index: number): string {
  if (step.kind === "tool_call") return toolCallRowKey(step.callId);
  return indexedStreamKey(index, step.kind);
}

function nestedStepsFromEvents(events: SubagentUpdateEvent[]): NestedStep[] {
  let steps: NestedStep[] = [];
  for (const event of events) {
    if (event.parentDelegationId) continue;
    steps = applyNestedStep(steps, event.step);
  }
  return steps;
}

function isLiveNestedThinking(steps: NestedStep[], index: number): boolean {
  for (let i = index + 1; i < steps.length; i++) {
    const kind = steps[i]?.kind;
    if (kind === "thinking" || kind === "text" || kind === "tool_call") {
      return false;
    }
  }
  return true;
}

function AgentRunStepRow({
  step,
  thinkingOpen,
}: {
  step: NestedStep;
  thinkingOpen?: boolean;
}) {
  switch (step.kind) {
    case "text":
      return (
        <TranscriptMarkdownText text={step.text} data-run-step="text" />
      );
    case "thinking":
      return (
        <TranscriptThinking
          text={step.text}
          open={thinkingOpen}
          density="compact"
          data-run-step="thinking"
        />
      );
    case "tool_call":
      return (
        <TranscriptToolCall
          callId={step.callId}
          name={step.name}
          status={step.status}
          args={step.args}
          result={step.result}
          density="compact"
          data-run-step="tool_call"
        />
      );
    default:
      return null;
  }
}

function AgentRunBody({
  issueId,
  delegationId,
  running,
}: {
  issueId: string;
  delegationId: string;
  running: boolean;
}) {
  const { data, isLoading, error } = useIssueAgentRunEventsQuery(
    issueId,
    delegationId,
    true,
  );

  if (isLoading) {
    return (
      <div
        className="space-y-2 border-t border-border px-3 py-3"
        data-slot="agent-run-body"
        data-state="loading"
        aria-busy="true"
        aria-label="Loading run transcript"
      >
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="border-t border-border px-3 py-3"
        data-slot="agent-run-body"
        data-state="error"
      >
        <ShellInlineFault
          message={error.message}
          hint="Expand again later or reload the page."
        />
      </div>
    );
  }

  const steps = nestedStepsFromEvents(data?.events ?? []);
  const segments = groupOrdinaryNestedToolCalls(steps, new Map());

  return (
    <div
      className="min-w-0 space-y-2 border-t border-border px-3 py-3"
      data-slot="agent-run-body"
      data-state="ready"
    >
      {segments.map((segment) => {
        if (segment.kind === "tool_use_group") {
          return (
            <ToolUseGroup
              key={`tool_use_group-${segment.steps[0]!.callId}`}
              tools={segment.steps}
              density="compact"
              data-run-step="tool_call"
            />
          );
        }
        const { step } = segment;
        const index = steps.indexOf(step);
        return (
          <div key={nestedStepKey(step, index)}>
            <AgentRunStepRow
              step={step}
              thinkingOpen={
                running &&
                step.kind === "thinking" &&
                isLiveNestedThinking(steps, index)
              }
            />
          </div>
        );
      })}
    </div>
  );
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

export function AgentRunCard({
  run,
  issueId,
}: {
  run: AgentRun;
  issueId: string;
}) {
  const running = run.status === "running";
  const [expanded, setExpanded] = useState(running);
  const duration = runDuration(run);

  return (
    <div
      className="min-w-0 overflow-hidden rounded-lg border border-border bg-card"
      data-run-id={run.delegationId}
      data-status={run.status}
      {...(expanded ? { "data-expanded": "" } : {})}
    >
      <button
        type="button"
        className="flex min-h-11 w-full min-w-0 cursor-pointer flex-wrap items-center gap-x-1.5 gap-y-1 border-l-2 border-l-[hsl(var(--current))] px-3 py-2.5 text-left font-mono text-[11px] text-muted-foreground"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
        data-testid="agent-run-card-header"
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform",
            expanded && "rotate-90",
          )}
          aria-hidden
        />
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
      </button>
      {expanded ? (
        <AgentRunBody
          issueId={issueId}
          delegationId={run.delegationId}
          running={running}
        />
      ) : null}
    </div>
  );
}

const EMPTY_RUNS: AgentRun[] = [];

export function AgentRunsPanel({
  issueId,
  projectId,
}: {
  issueId: string;
  projectId: string;
}) {
  const { data, isLoading, error } = useIssueAgentRunsQuery(issueId);
  const runs = useWorkRootAgentRuns(
    issueId,
    data?.workRoot?.conversationId,
    data?.runs ?? EMPTY_RUNS,
  );

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
        <AgentRunCard key={run.delegationId} run={run} issueId={issueId} />
      ))}
    </div>
  );
}
