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

const LIVE_LABEL = {
  starting: "Researcher starting…",
  running: "Researching…",
} as const;

/** Starting, live, or failed researcher on an open question thread awaiting its answer. */
export function QuestionResearcherStatus({ run }: { run: ResearcherRun }) {
  if (run.status !== "failed") {
    return (
      <div
        data-testid={`researcher-${run.status}`}
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 py-2 text-sm text-[hsl(var(--current))]"
      >
        <Loader2 className="h-4 w-4 shrink-0 motion-safe:animate-spin" aria-hidden />
        <span>{LIVE_LABEL[run.status]}</span>
      </div>
    );
  }

  return (
    <div data-testid="researcher-failed" className="my-2 flex min-w-0 flex-col gap-2">
      <ShellInlineFault
        message={`Researcher couldn't get an answer — ${run.error}`}
        hint="Retry to start a fresh researcher run for this question."
      />
    </div>
  );
}
