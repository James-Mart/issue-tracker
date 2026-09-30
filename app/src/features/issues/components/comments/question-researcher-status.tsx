import { Loader2, RotateCcw } from "lucide-react";
import type { ResearcherRun } from "@server/schemas";
import { ShellInlineFault } from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import { useRetryQuestionResearcher } from "../../api/mutations";

/** Live or failed researcher on an open question thread awaiting its answer. */
export function QuestionResearcherStatus({
  storyId,
  threadId,
  run,
}: {
  storyId: string;
  threadId: string;
  run: ResearcherRun;
}) {
  const retry = useRetryQuestionResearcher(storyId);

  if (run.status === "running") {
    return (
      <div
        data-testid="researcher-running"
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 py-2 text-sm text-[hsl(var(--current))]"
      >
        <Loader2 className="h-4 w-4 shrink-0 motion-safe:animate-spin" aria-hidden />
        <span>Researching…</span>
      </div>
    );
  }

  return (
    <div data-testid="researcher-failed" className="my-2 flex min-w-0 flex-col gap-2">
      <ShellInlineFault
        message={`Researcher couldn't get an answer — ${run.error}`}
        hint="Retry to start a fresh researcher run for this question."
      />
      <Button
        type="button"
        size="sm"
        className="self-end"
        onClick={() => retry.mutate(threadId)}
        disabled={retry.isPending}
        data-testid="researcher-retry"
      >
        <RotateCcw aria-hidden />
        Retry
      </Button>
    </div>
  );
}
