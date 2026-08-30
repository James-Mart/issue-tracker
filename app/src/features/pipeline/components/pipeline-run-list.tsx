import {
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
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
import { usePipelineRunsLive } from "../api/live";
import { usePipelineRunsQuery } from "../api/queries";
import { pipelineRunPath } from "../paths";
import {
  conditionBadgeLabel,
  formatRunStartedAt,
  recoveredMarkerLabel,
  type RecentRun,
  type RunCondition,
} from "../run-list";

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

function RunRecoveredMarker({ count }: { count: number }) {
  return (
    <span
      className="shrink-0 font-mono text-[10px] text-[hsl(var(--warn))]"
      data-testid="pipeline-run-recovered-marker"
    >
      {recoveredMarkerLabel(count)}
    </span>
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
      to={pipelineRunPath(run.conversationId)}
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
        <div className="flex shrink-0 items-center gap-1.5">
          <RunConditionBadge condition={run.condition} />
          {run.recoveredErrors != null ? (
            <RunRecoveredMarker count={run.recoveredErrors} />
          ) : null}
        </div>
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

function RunsScrollPagingFoot({
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  scrollRootRef,
  isMobile,
  loadedPageCount,
}: {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => Promise<unknown>;
  scrollRootRef: RefObject<HTMLElement | null>;
  isMobile: boolean;
  loadedPageCount: number;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const pagingRef = useRef(false);

  const loadNextPage = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage || pagingRef.current) return;
    pagingRef.current = true;
    void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return;

    pagingRef.current = false;

    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const root = isMobile ? null : scrollRootRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadNextPage();
        }
      },
      { root, threshold: 0 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [
    hasNextPage,
    isFetchingNextPage,
    isMobile,
    loadNextPage,
    scrollRootRef,
    loadedPageCount,
  ]);

  if (!hasNextPage) return null;

  if (isFetchingNextPage) {
    return (
      <div
        className="flex items-center justify-center gap-2 py-3 font-mono text-[11px] text-muted-foreground"
        data-testid="pipeline-run-list-loading-foot"
        role="status"
        aria-live="polite"
      >
        <Loader2
          className="h-3.5 w-3.5 motion-safe:animate-spin"
          aria-hidden
        />
        Loading older runs…
      </div>
    );
  }

  return (
    <div
      ref={sentinelRef}
      data-testid="pipeline-run-list-sentinel"
      aria-hidden
      className="h-px w-full shrink-0"
    />
  );
}

export function PipelineRunsView({
  conversationId,
  renderSequence,
}: {
  conversationId?: string;
  renderSequence?: (
    conversationId: string,
    layout: "desktop" | "phone",
  ) => ReactNode;
}) {
  const isMobile = useIsMobile();
  const scrollRootRef = useRef<HTMLElement>(null);
  usePipelineRunsLive();
  const {
    data,
    isLoading,
    error,
    refetch,
    isFetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = usePipelineRunsQuery();
  const runs = data?.pages.flatMap((page) => page.runs) ?? [];

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
            ref={scrollRootRef}
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
                {runs.map((run) => (
                  <PipelineRunCard
                    key={run.conversationId}
                    run={run}
                    selected={run.conversationId === conversationId}
                  />
                ))}
                <RunsScrollPagingFoot
                  hasNextPage={hasNextPage === true}
                  isFetchingNextPage={isFetchingNextPage}
                  fetchNextPage={fetchNextPage}
                  scrollRootRef={scrollRootRef}
                  isMobile={isMobile}
                  loadedPageCount={data?.pages.length ?? 0}
                />
              </div>
            )}
          </section>
          {conversationId && renderSequence && !isMobile ? (
            renderSequence(conversationId, "desktop")
          ) : conversationId ? null : (
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
      {conversationId && renderSequence && isMobile
        ? renderSequence(conversationId, "phone")
        : null}
    </div>
  );
}
