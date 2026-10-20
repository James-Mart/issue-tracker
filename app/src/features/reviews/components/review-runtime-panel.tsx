import { useEffect, useState } from "react";
import { Loader2, Play, Square } from "lucide-react";
import type { ReviewRuntimeStatus, RuntimeBootPhase } from "@server/schemas";
import { Button } from "@/components/ui/button";
import {
  useStartReviewRuntime,
  useStopReviewRuntime,
} from "../api/mutations";
import { useReviewRuntimeLogQuery, useReviewRuntimeQuery } from "../api/queries";
import {
  bootingPhaseRowLabel,
  formatBootPhaseElapsed,
} from "../lib/runtime-boot-phase";
import { ReviewRuntimeLogModal } from "./review-runtime-log-modal";

function actionIcon(icon: "play" | "stop" | "spin") {
  switch (icon) {
    case "spin":
      return <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />;
    case "stop":
      return <Square aria-hidden />;
    case "play":
      return <Play aria-hidden />;
  }
}

export function ReviewRuntimePanel({
  projectId,
  reviewId,
}: {
  projectId: string;
  reviewId: string;
}) {
  const runtime = useReviewRuntimeQuery(reviewId);
  const start = useStartReviewRuntime(projectId, reviewId);
  const stop = useStopReviewRuntime(projectId, reviewId);
  const status: ReviewRuntimeStatus | undefined = start.isPending
    ? { state: "booting" }
    : runtime.data;
  const [logOpen, setLogOpen] = useState(false);
  const state = status?.state;
  const showLogs = state === "booting" || state === "failed";
  const logQuery = useReviewRuntimeLogQuery(reviewId, logOpen && showLogs);

  useEffect(() => {
    if (state === "running" || state === "stopped") setLogOpen(false);
  }, [state]);

  return (
    <>
      <ReviewRuntimeRow
        projectId={projectId}
        status={status}
        loadError={runtime.error?.message}
        stopPending={stop.isPending}
        onStart={() => start.mutate()}
        onStop={() => stop.mutate()}
        onViewLogs={showLogs ? () => setLogOpen(true) : undefined}
      />
      <ReviewRuntimeLogModal
        open={logOpen}
        onOpenChange={setLogOpen}
        phase={runtimePhaseForLog(status)}
        failed={state === "failed"}
        log={logQuery.data}
        loading={logQuery.isPending && !logQuery.data}
      />
    </>
  );
}

function runtimePhaseForLog(
  status: ReviewRuntimeStatus | undefined,
): RuntimeBootPhase | undefined {
  if (!status) return undefined;
  if (status.state === "failed") return status.failedPhase;
  if (status.state === "booting") return status.phase;
  return undefined;
}

export function ReviewRuntimeRow({
  projectId,
  status,
  loadError,
  stopPending = false,
  onStart,
  onStop,
  onViewLogs,
}: {
  projectId: string;
  status: ReviewRuntimeStatus | undefined;
  loadError?: string;
  stopPending?: boolean;
  onStart: () => void;
  onStop: () => void;
  onViewLogs?: () => void;
}) {
  const state = status?.state;
  const action = rowAction(state, stopPending);

  return (
    <div
      className="mt-2 flex w-full flex-wrap items-center justify-start gap-x-2 gap-y-1 rounded-md border border-border bg-card px-3 py-2 text-sm"
      data-testid="review-runtime"
      data-state={state ?? "loading"}
    >
      <span className="font-mono text-foreground">{projectId} runtime</span>
      {action ? (
        <Button
          type="button"
          size="sm"
          variant={action.stops ? "outline" : "current"}
          className="shrink-0"
          data-testid="review-runtime-action"
          disabled={action.pending}
          aria-busy={action.pending || undefined}
          onClick={action.stops ? onStop : onStart}
        >
          {actionIcon(action.icon)}
          {action.label}
        </Button>
      ) : null}
      {state === "booting" ? (
        <BootingRuntimeStatus
          phase={status?.phase}
          phaseStartedAt={status?.phaseStartedAt}
        />
      ) : null}
      {state === "running" && status?.baseUrl ? (
        <a
          href={status.baseUrl}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 break-all font-mono text-[hsl(var(--current))] hover:underline"
          data-testid="review-runtime-status"
        >
          {status.baseUrl}
        </a>
      ) : null}
      {state === "failed" ? (
        <p className="min-w-0 text-destructive" data-testid="review-runtime-status" role="status">
          {status?.error ?? "Runtime failed to start."}
        </p>
      ) : null}
      {onViewLogs ? (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto px-0 py-0 font-normal"
          data-testid="review-runtime-view-logs"
          onClick={onViewLogs}
        >
          View logs
        </Button>
      ) : null}
      {loadError && !status ? (
        <p className="min-w-0 text-destructive" data-testid="review-runtime-status" role="alert">
          {loadError}
        </p>
      ) : null}
    </div>
  );
}

function BootingRuntimeStatus({
  phase,
  phaseStartedAt,
}: {
  phase: RuntimeBootPhase | undefined;
  phaseStartedAt: string | undefined;
}) {
  const [now, setNow] = useState(() => Date.now());
  const tickPhase = phaseStartedAt !== undefined;
  useEffect(() => {
    if (!tickPhase) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [tickPhase, phaseStartedAt]);

  const label = phase !== undefined ? bootingPhaseRowLabel(phase) : "Booting…";
  const elapsed =
    phaseStartedAt !== undefined ? formatBootPhaseElapsed(phaseStartedAt, now) : undefined;
  return (
    <p
      className="flex min-w-0 items-center gap-1.5 text-sm text-[hsl(var(--current))]"
      data-testid="review-runtime-status"
      role="status"
    >
      <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
      <span>{label}</span>
      {elapsed ? (
        <time
          dateTime={phaseStartedAt}
          className="font-mono text-xs tabular-nums"
          aria-hidden
        >
          {elapsed}
        </time>
      ) : null}
    </p>
  );
}

function rowAction(
  state: ReviewRuntimeStatus["state"] | undefined,
  stopPending: boolean,
):
  | { label: string; icon: "play" | "stop" | "spin"; stops: boolean; pending: boolean }
  | undefined {
  switch (state) {
    case "running":
    case "booting":
      return stopPending
        ? { label: "Stopping…", icon: "spin", stops: true, pending: true }
        : { label: "Stop", icon: "stop", stops: true, pending: false };
    case "failed":
      return { label: "Retry start", icon: "play", stops: false, pending: false };
    case "stopped":
      return { label: "Start", icon: "play", stops: false, pending: false };
    default:
      return undefined;
  }
}
