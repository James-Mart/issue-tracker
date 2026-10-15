import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import type { ReviewAgentRun } from "@server/schemas";
import { ShellInlineFault, ShellLoadingState, ShellState } from "@/app/shell-state";
import { Badge } from "@/components/ui/badge";
import { agentsConversationPath } from "@/features/agents/lib/links";
import {
  formatRunDurationBetween,
  formatRunStartTime,
} from "@/features/issues/lib/run-time-format";
import type { CommentThread } from "@/features/issues/lib/comment-threads";
import { toolStatusVariant } from "@/features/agents/components/transcript-ui";
import { cn } from "@/lib/utils/cn";
import { useReviewAgentRunsQuery } from "../api/queries";
import { useReviewCommentThreads } from "../hooks/use-review-comments";
import { useWideReviewWorkbench } from "../hooks/use-wide-review-workbench";
import {
  reviewAgentRoleLabel,
  reviewAgentRunName,
  reviewRunExpansion,
  seedReviewRunLatch,
  toggleReviewRunExpansion,
  type ReviewAgentRunName,
} from "../lib/review-agent-runs";
import { ReviewAgentTranscript } from "./review-agent-transcript";

function RunMeta({
  run,
  expanded,
  showChevron,
}: {
  run: ReviewAgentRun;
  expanded: boolean;
  showChevron: boolean;
}) {
  const running = run.status === "running";
  const duration = formatRunDurationBetween(run.startedAt, run.endedAt);
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
      {showChevron ? (
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 motion-safe:transition-transform",
            expanded && "rotate-90",
          )}
          aria-hidden
        />
      ) : null}
      <Badge
        variant={toolStatusVariant(run.status)}
        className={cn("shrink-0 text-[10px]", running && "motion-safe:animate-pulse")}
        data-status-indicator={run.status}
      >
        {run.status}
      </Badge>
      <span className="shrink-0 text-xs font-medium text-foreground">
        {reviewAgentRoleLabel(run.role)}
      </span>
      <span className="min-w-0 truncate text-[11px]">{run.model}</span>
      <span className="shrink-0 tabular-nums text-[hsl(var(--mut))]" data-started-at={run.startedAt}>
        {formatRunStartTime(run.startedAt)}
      </span>
      {duration ? (
        <span className="shrink-0 tabular-nums text-[hsl(var(--mut))]" data-duration={duration}>
          {duration}
        </span>
      ) : null}
    </span>
  );
}

function RunNameText({ text }: { text: string }) {
  return (
    <span className="block w-full min-w-0 text-xs font-medium leading-snug text-foreground">
      {text}
    </span>
  );
}

function RunNameLink({
  name,
  onOpen,
}: {
  name: ReviewAgentRunName;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="block w-full min-w-0 px-3 pb-2.5 text-left text-xs font-medium leading-snug text-[hsl(var(--current))] underline underline-offset-2"
      data-testid="review-agent-run-name"
      onClick={onOpen}
    >
      {name.text}
    </button>
  );
}

function ReviewAgentRunCard({
  run,
  wide,
  expanded,
  onToggle,
  onOpenName,
}: {
  run: ReviewAgentRun;
  wide: boolean;
  expanded: boolean;
  onToggle: () => void;
  onOpenName: (name: ReviewAgentRunName) => void;
}) {
  const name = reviewAgentRunName(run);
  const label = reviewAgentRoleLabel(run.role);
  const meta = <RunMeta run={run} expanded={expanded} showChevron={wide} />;
  const plainName = name && !name.target ? <RunNameText text={name.text} /> : null;

  return (
    <div
      className="min-w-0 overflow-hidden rounded-lg border border-border bg-card"
      data-testid="review-agent-run-card"
      data-conversation-id={run.conversationId}
      data-status={run.status}
      {...(expanded ? { "data-expanded": "" } : {})}
    >
      <div className="flex min-w-0 flex-col border-l-2 border-l-[hsl(var(--current))] shell:flex-row shell:items-stretch">
        <div className="min-w-0 flex-1">
          {wide ? (
            <button
              type="button"
              className="flex min-h-11 w-full min-w-0 cursor-pointer flex-col gap-1 px-3 py-2.5 text-left font-mono text-[11px] text-muted-foreground"
              aria-expanded={expanded}
              aria-label={`${expanded ? "Collapse" : "Expand"} ${label} transcript`}
              data-testid="agent-run-card-header"
              onClick={onToggle}
            >
              {meta}
              {plainName}
            </button>
          ) : (
            <div
              className="flex min-h-11 min-w-0 flex-col gap-1 px-3 py-2.5 font-mono text-[11px] text-muted-foreground"
              data-testid="agent-run-card-header"
            >
              {meta}
              {plainName}
            </div>
          )}
          {name?.target ? (
            <RunNameLink name={name} onOpen={() => onOpenName(name)} />
          ) : null}
        </div>
        <Link
          to={agentsConversationPath(run.conversationId)}
          className="inline-flex min-h-11 shrink-0 items-center px-3 text-[11px] font-medium text-[hsl(var(--current))] no-underline hover:underline hover:underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="agent-run-open-in-agents"
        >
          Open in Agents
        </Link>
      </div>
      {expanded ? <ReviewAgentTranscript conversationId={run.conversationId} /> : null}
    </div>
  );
}

/** Agents tab: one card per top-level review run, oldest first. */
export function ReviewAgentsTab({
  projectId,
  reviewId,
  onOpenThread,
  onOpenThreadId,
  onOpenSubmission,
  onOpenStandardsRound,
}: {
  projectId: string;
  reviewId: string;
  onOpenThread: (thread: CommentThread) => void;
  onOpenThreadId: (threadId: string) => void;
  onOpenSubmission: (submissionId: string) => void;
  onOpenStandardsRound: (submissionId: string) => void;
}) {
  const { data, isLoading, error } = useReviewAgentRunsQuery(projectId, reviewId);
  const { threads } = useReviewCommentThreads(reviewId);
  const wide = useWideReviewWorkbench() === true;
  const [latch, setLatch] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const listed = data?.runs;
  const runs = listed ?? [];

  useEffect(() => {
    setLatch((current) => seedReviewRunLatch(current, listed ?? [], wide));
  }, [listed, wide]);

  function expandedFor(run: ReviewAgentRun): boolean {
    return reviewRunExpansion(
      latch.get(run.conversationId),
      run.status === "running",
      wide,
    ).expanded;
  }

  function toggle(run: ReviewAgentRun) {
    const next = toggleReviewRunExpansion(
      latch.get(run.conversationId),
      run.status === "running",
      true,
    );
    const latched = next.latched;
    if (latched === undefined) return;
    setLatch((current) => {
      const copy = new Map(current);
      copy.set(run.conversationId, latched);
      return copy;
    });
  }

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

  if (runs.length === 0) {
    return (
      <div data-testid="review-agents-empty" data-slot="agent-runs-panel">
        <ShellState
          className="border-0 bg-transparent px-4 py-8 shadow-none"
          eyebrow="Agents"
          title="No agent has run against this review yet."
        />
      </div>
    );
  }

  function openName(run: ReviewAgentRun, name: ReviewAgentRunName) {
    if (name.target === "thread" && run.threadId) {
      const thread = threads.find((item) => item.root.id === run.threadId);
      if (thread) onOpenThread(thread);
      else onOpenThreadId(run.threadId);
      return;
    }
    if (!run.submissionId) return;
    if (name.target === "conversation") onOpenSubmission(run.submissionId);
    if (name.target === "standards") onOpenStandardsRound(run.submissionId);
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto py-2"
      data-testid="review-agents-tab"
      data-slot="agent-runs-panel"
    >
      {runs.map((run) => (
        <ReviewAgentRunCard
          key={run.conversationId}
          run={run}
          wide={wide}
          expanded={expandedFor(run)}
          onToggle={() => toggle(run)}
          onOpenName={(name) => openName(run, name)}
        />
      ))}
    </div>
  );
}
