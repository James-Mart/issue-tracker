import { Loader2, XCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { currentGlow } from "@/components/ui/overlay-surfaces";
import {
  ShellInlineFault,
  ShellLoadingState,
  ShellState,
} from "@/app/shell-state";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils/cn";
import { usePipelineRunQuery, usePipelineRunsQuery } from "../api/queries";
import { useLiveRunSequence } from "../hooks/use-live-run-sequence";
import {
  PHONE_RUN_LIST_SLOTS,
  conditionBadgeLabel,
  formatRunStartedAt,
  runListSegments,
  type RecentRun,
  type RunCondition,
} from "../run-list";
import { RunSequenceDiagram } from "./run-sequence-diagram";

function conditionBadgeVariant(
  condition: RunCondition,
): "current" | "done" | "blocked" {
  if (condition === "in-flight") return "current";
  if (condition === "completed") return "done";
  return "blocked";
}

function RunConditionBadge({ condition }: { condition: RunCondition }) {
  const label = conditionBadgeLabel(condition);
  return (
    <Badge
      variant={conditionBadgeVariant(condition)}
      className="gap-1 font-mono text-[10px]"
      data-condition={condition}
    >
      {condition === "in-flight" ? (
        <Loader2 className="h-3 w-3 motion-safe:animate-spin" aria-hidden />
      ) : null}
      {condition === "failed" ? (
        <XCircle className="h-3 w-3" aria-hidden />
      ) : null}
      {label}
    </Badge>
  );
}

function PipelineRunCard({
  run,
  selected,
}: {
  run: RecentRun;
  selected: boolean;
}) {
  return (
    <Link
      to={`/pipeline/runs/${encodeURIComponent(run.conversationId)}`}
      aria-current={selected ? "true" : undefined}
      data-testid="pipeline-run-card"
      data-conversation-id={run.conversationId}
      data-condition={run.condition}
      data-current={selected ? "true" : undefined}
      className={cn(
        "block w-full rounded-lg border px-3 py-2.5 text-left no-underline transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? cn(
              "border-[hsl(var(--current))]",
              currentGlow,
              run.condition === "failed"
                ? "bg-[hsl(var(--blocked)/0.06)]"
                : "bg-[hsl(var(--current)/0.08)]",
            )
          : run.condition === "failed"
            ? "border-border bg-[hsl(var(--blocked)/0.03)] hover:border-[hsl(var(--rail-lit))]"
            : "border-border bg-card hover:border-[hsl(var(--rail-lit))]",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {run.coordinatorLabel}
          </p>
          <p className="truncate font-mono text-[10px] text-muted-foreground">
            {run.conversationId}
          </p>
        </div>
        <RunConditionBadge condition={run.condition} />
      </div>
      <p
        className="mt-1.5 font-mono text-[10px] text-muted-foreground"
        data-started-at={run.startedAt}
      >
        {formatRunStartedAt(run.startedAt)}
      </p>
    </Link>
  );
}

function RunListElision({ omitted }: { omitted: RecentRun[] }) {
  const labels = omitted.map((run) => run.coordinatorLabel).join(", ");
  const count = omitted.length;
  return (
    <div
      className="flex items-center gap-2 py-0.5"
      role="note"
      data-testid="pipeline-run-elision"
      aria-label={`${count} run${count === 1 ? "" : "s"} omitted: ${labels}`}
    >
      <span className="h-px min-w-4 flex-1 bg-[hsl(var(--rail))]" aria-hidden />
      <span className="min-w-0 truncate font-mono text-[10px] leading-tight text-muted-foreground">
        <span aria-hidden>↕ </span>
        {count} omitted
        <span aria-hidden> · </span>
        <span className="text-foreground/75">{labels}</span>
      </span>
      <span className="h-px min-w-4 flex-1 bg-[hsl(var(--rail))]" aria-hidden />
    </div>
  );
}

function SelectedRunSequence({
  conversationId,
  layout,
}: {
  conversationId: string;
  layout: "desktop" | "phone";
}) {
  const { data, isLoading, error, refetch, isFetching } =
    usePipelineRunQuery(conversationId);
  const sequence = useLiveRunSequence(conversationId, data);

  if (isLoading) {
    return (
      <div className="min-w-0 flex-1">
        <ShellLoadingState label="Loading sequence…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-w-0 flex-1">
        <ShellInlineFault
          message={error.message}
          hint="Check the server, then reload."
        />
        <Button
          variant="primary"
          size="sm"
          className="mt-3"
          disabled={isFetching}
          onClick={() => {
            void refetch();
          }}
        >
          Reload
        </Button>
      </div>
    );
  }

  if (!sequence) return null;

  return <RunSequenceDiagram sequence={sequence} layout={layout} />;
}

export function PipelineRunsView({
  conversationId,
}: {
  conversationId?: string;
}) {
  const isMobile = useIsMobile();
  const { data, isLoading, error, refetch, isFetching } =
    usePipelineRunsQuery();
  const runs = data?.runs ?? [];
  const segments = runListSegments(
    runs,
    conversationId,
    isMobile ? PHONE_RUN_LIST_SLOTS : null,
  );

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="font-display text-xl font-semibold text-foreground shell:text-2xl">
          Runs
        </h1>
        <p className="max-w-[52ch] text-sm text-muted-foreground">
          Recent runs across all conversations — select one for its as-run
          sequence.
        </p>
      </div>
      {isLoading ? (
        <ShellLoadingState label="Loading runs…" />
      ) : error ? (
        <div>
          <ShellInlineFault
            message={error.message}
            hint="Check the server, then reload."
          />
          <Button
            variant="primary"
            size="sm"
            className="mt-3"
            disabled={isFetching}
            onClick={() => {
              void refetch();
            }}
          >
            Reload
          </Button>
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-3 shell:flex-row shell:items-start shell:gap-4">
          <section
            className="min-w-0 shell:max-h-[calc(100svh-14rem)] shell:w-[16.5rem] shell:shrink-0 shell:overflow-y-auto"
            aria-label="Recent runs"
          >
            <h2 className="mb-2 font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Recent runs
            </h2>
            {runs.length === 0 ? (
              <ShellState
                className="px-4 py-8"
                eyebrow="Empty"
                title="No runs yet."
                detail="Runs appear here once a conversation has executed the pipeline."
              />
            ) : (
              <div
                className="flex flex-col gap-2"
                data-testid="pipeline-run-list"
              >
                {segments.map((segment, index) =>
                  segment.kind === "run" ? (
                    <PipelineRunCard
                      key={segment.run.conversationId}
                      run={segment.run}
                      selected={
                        segment.run.conversationId === conversationId
                      }
                    />
                  ) : (
                    <RunListElision
                      key={`elision-${index}`}
                      omitted={segment.omitted}
                    />
                  ),
                )}
              </div>
            )}
          </section>
          {conversationId ? (
            <SelectedRunSequence
              conversationId={conversationId}
              layout={isMobile ? "phone" : "desktop"}
            />
          ) : (
            <div
              data-testid="pipeline-run-sequence-placeholder"
              className="flex min-h-[16rem] min-w-0 flex-1 items-center justify-center rounded-lg border border-border bg-[hsl(var(--panel)/0.35)] px-6 py-10 text-center text-sm text-muted-foreground shell:min-h-[calc(100svh-14rem)]"
            >
              Select a run to see its sequence — lifelines, gates, and loops as
              they occurred.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
