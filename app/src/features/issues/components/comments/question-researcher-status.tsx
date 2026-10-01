import { useEffect, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import type { ResearcherRun } from "@server/schemas";
import { ShellInlineFault } from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import { useRetryQuestionResearcher } from "../../api/mutations";

/** Retry sits in the question card footer, ahead of Dismiss and Convert. */
export function ResearcherRetryButton({
  storyId,
  threadId,
}: {
  storyId: string;
  threadId: string;
}) {
  const retry = useRetryQuestionResearcher(storyId);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => retry.mutate(threadId)}
      disabled={retry.isPending}
      data-testid="researcher-retry"
    >
      <RotateCcw aria-hidden />
      Retry
    </Button>
  );
}

const LIVE_COPY = {
  running: "Researcher is looking into this…",
  finishing: "Posting answer…",
} as const;

/** Elapsed run time as m:ss, or h:mm:ss once an hour has passed. */
function formatResearcherElapsed(startedAt: string, now: number): string {
  const total = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const clock = `${minutes}:${String(seconds).padStart(2, "0")}`;
  if (hours === 0) return clock;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Live, posting, or failed researcher on an open question thread awaiting its answer. */
export function QuestionResearcherStatus({ run }: { run: ResearcherRun }) {
  const live = run.status === "running";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live, run.startedAt]);

  if (run.status === "failed") {
    return (
      <div data-testid="researcher-failed" className="my-2 flex min-w-0 flex-col gap-2">
        <ShellInlineFault
          message={`Researcher couldn't get an answer — ${run.error}`}
          hint="Retry to start a fresh researcher run for this question."
        />
      </div>
    );
  }

  const elapsed = live ? formatResearcherElapsed(run.startedAt, now) : undefined;
  return (
    <div
      data-testid={`researcher-${run.status}`}
      className="flex items-center gap-2 py-2 text-sm text-[hsl(var(--current))]"
    >
      <Loader2 className="h-4 w-4 shrink-0 motion-safe:animate-spin" aria-hidden />
      <span role="status" aria-live="polite">
        {LIVE_COPY[run.status]}
      </span>
      {elapsed ? (
        <time
          dateTime={run.startedAt}
          aria-hidden
          data-testid="researcher-elapsed"
          className="ml-auto shrink-0 font-mono text-xs tabular-nums text-muted-foreground"
        >
          {elapsed}
        </time>
      ) : null}
    </div>
  );
}
