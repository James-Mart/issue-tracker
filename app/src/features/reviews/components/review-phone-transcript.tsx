import { ArrowLeft } from "lucide-react";
import type { ReviewAgentRun } from "@server/schemas";
import { ShellInlineFault, ShellLoadingState } from "@/app/shell-state";
import { reviewAgentRoleLabel } from "../lib/review-agent-runs";
import { ReviewAgentTranscript } from "./review-agent-transcript";
import { ReviewRunOpenInAgents } from "./review-run-open-in-agents";

/** Phone transcript. The review page shell gives this column the viewport height. */
export function ReviewPhoneTranscript({
  backLabel,
  run,
  pending,
  errorMessage,
  onBack,
}: {
  backLabel: string;
  /** Null once the run list has loaded and this id is not on the review. */
  run: ReviewAgentRun | null;
  pending: boolean;
  errorMessage: string | null;
  onBack: () => void;
}) {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      data-testid="review-phone-transcript"
      data-conversation-id={run?.conversationId}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4">
        <button
          type="button"
          className="inline-flex min-h-11 shrink-0 items-center gap-1 px-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Back to ${backLabel}`}
          data-testid="review-transcript-back"
          onClick={onBack}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {backLabel}
        </button>
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {run ? reviewAgentRoleLabel(run.role) : "Transcript"}
        </h2>
        {run ? <ReviewRunOpenInAgents conversationId={run.conversationId} /> : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {errorMessage ? (
          <ShellInlineFault
            message={errorMessage}
            hint="Reload the page or try again in a moment."
          />
        ) : pending ? (
          <ShellLoadingState label="Loading run transcript…" />
        ) : run ? (
          <ReviewAgentTranscript conversationId={run.conversationId} fill />
        ) : (
          <ShellInlineFault
            message="This review has no run with that id."
            hint="Return to the review."
          />
        )}
      </div>
    </div>
  );
}
