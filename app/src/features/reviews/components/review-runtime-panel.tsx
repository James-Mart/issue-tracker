import { Loader2, Play, Square } from "lucide-react";
import type { ReviewRuntimeStatus } from "@server/schemas";
import { Button } from "@/components/ui/button";
import {
  useStartReviewRuntime,
  useStopReviewRuntime,
} from "../api/mutations";
import { useReviewRuntimeQuery } from "../api/queries";

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
  return (
    <ReviewRuntimeRow
      projectId={projectId}
      status={status}
      loadError={runtime.error?.message}
      stopPending={stop.isPending}
      onStart={() => start.mutate()}
      onStop={() => stop.mutate()}
    />
  );
}

export function ReviewRuntimeRow({
  projectId,
  status,
  loadError,
  stopPending = false,
  onStart,
  onStop,
}: {
  projectId: string;
  status: ReviewRuntimeStatus | undefined;
  loadError?: string;
  stopPending?: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  const state = status?.state;
  const action = rowAction(state);
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
          variant={state === "running" ? "outline" : "current"}
          className="shrink-0"
          data-testid="review-runtime-action"
          disabled={state === "booting" || (state === "running" && stopPending)}
          aria-busy={state === "booting" || undefined}
          onClick={() => {
            if (state === "running") onStop();
            else onStart();
          }}
        >
          {actionIcon(action.icon)}
          {action.label}
        </Button>
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
      {loadError && !status ? (
        <p className="min-w-0 text-destructive" data-testid="review-runtime-status" role="alert">
          {loadError}
        </p>
      ) : null}
    </div>
  );
}

function rowAction(
  state: ReviewRuntimeStatus["state"] | undefined,
): { label: string; icon: "play" | "stop" | "spin" } | undefined {
  switch (state) {
    case "running":
      return { label: "Stop", icon: "stop" };
    case "booting":
      return { label: "Booting...", icon: "spin" };
    case "failed":
      return { label: "Retry start", icon: "play" };
    case "stopped":
      return { label: "Start", icon: "play" };
    default:
      return undefined;
  }
}
