import { useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import type { ReviewSubmitDestination, ReviewView } from "@server/schemas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CommentThread } from "@/features/issues/lib/comment-threads";
import {
  useArchiveReview,
  useReopenReview,
  useRetryOpenReviewSubmissions,
  useSubmitReview,
} from "../api/mutations";
import type { ReviewSubmitHeader } from "../lib/review-submission-ui";
import { SubmitReviewDialog } from "./review-submit-dialog";

function ReviewStatusAction({
  projectId,
  review,
}: {
  projectId: string;
  review: ReviewView;
}) {
  const archive = useArchiveReview(projectId);
  const reopen = useReopenReview(projectId);
  if (review.status === "archived") {
    return (
      <Button
        type="button"
        size="sm"
        className="shrink-0"
        disabled={reopen.isPending}
        onClick={() => reopen.mutate(review.id)}
      >
        Reopen
      </Button>
    );
  }
  return (
    <Button
      type="button"
      size="sm"
      className="shrink-0"
      disabled={archive.isPending}
      onClick={() => archive.mutate(review.id)}
    >
      Archive
    </Button>
  );
}

function TaskingStatus({ label }: { label: string }) {
  return (
    <Badge
      variant="inProgress"
      className="h-8 gap-1.5 px-3 touch:h-11"
      data-testid="review-tasking-status"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden />
      {label}
    </Badge>
  );
}

function RetryAction({
  disabled,
  describedBy,
  onRetry,
}: {
  disabled: boolean;
  describedBy: string | undefined;
  onRetry: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      className="shrink-0"
      disabled={disabled}
      aria-describedby={describedBy}
      data-testid="review-submission-retry"
      onClick={onRetry}
    >
      <RefreshCw aria-hidden />
      Retry
    </Button>
  );
}

function SubmitAction({
  header,
  submitPending,
  describedBy,
  onOpen,
}: {
  header: ReviewSubmitHeader;
  submitPending: boolean;
  describedBy: string | undefined;
  onOpen: () => void;
}) {
  const submit = header.submit;
  if (!submit) return null;
  return (
    <Button
      type="button"
      size="sm"
      variant="primary"
      className="shrink-0"
      disabled={submit.disabled || submitPending}
      aria-describedby={describedBy}
      data-testid="submit-review"
      data-ready-count={submit.readyCount ?? ""}
      onClick={onOpen}
    >
      {submit.label}
    </Button>
  );
}

export function ReviewSubmitActions({
  projectId,
  review,
  header,
  submissionThreads,
  onAcknowledge,
  onAcknowledgeEnd,
  onRetryStart,
  onRetryEnd,
  hasCodingStandards,
}: {
  projectId: string;
  review: ReviewView;
  header: ReviewSubmitHeader;
  /** Included and held-back threads; undefined until comments load. */
  submissionThreads:
    | { included: readonly CommentThread[]; notIncluded: readonly CommentThread[] }
    | undefined;
  /** True when the Project has a coding-standards doc. Undefined while that is still loading. */
  hasCodingStandards: boolean | undefined;
  /** Tasking is acknowledged only for the Story destination. */
  onAcknowledge: () => void;
  onAcknowledgeEnd: () => void;
  onRetryStart: (submissionIds: readonly string[]) => void;
  onRetryEnd: () => void;
}) {
  const submit = useSubmitReview(projectId);
  const retry = useRetryOpenReviewSubmissions(projectId);
  const defaultDestination: ReviewSubmitDestination = review.story ? "story" : "idea";
  const [dialogOpen, setDialogOpen] = useState(false);
  const [destination, setDestination] = useState(defaultDestination);
  const [summary, setSummary] = useState("");
  const [assessStandards, setAssessStandards] = useState(false);
  const keepDraft = useRef(false);

  const resetDraft = () => {
    setSummary("");
    setDestination(defaultDestination);
    setAssessStandards(false);
  };

  const closeDialog = (next: boolean) => {
    if (!next && !keepDraft.current) resetDraft();
    if (!next) keepDraft.current = false;
    setDialogOpen(next);
  };

  const reason = header.submit?.reason ?? header.retry?.reason;
  const describedBy = reason ? "review-submit-merged-reason" : undefined;
  const retryAction = header.retry;

  return (
    <div
      data-testid="review-header-actions"
      className="ml-auto flex max-w-full flex-col items-end gap-1"
    >
      <div className="flex flex-wrap items-center justify-end gap-2">
        {retryAction ? (
          <RetryAction
            disabled={retryAction.disabled || retry.isPending}
            describedBy={describedBy}
            onRetry={() => {
              onRetryStart(retryAction.submissionIds);
              retry.mutate(review.id, {
                onSuccess: () => onRetryEnd(),
                onError: () => onRetryEnd(),
              });
            }}
          />
        ) : null}
        {header.taskingLabel ? <TaskingStatus label={header.taskingLabel} /> : null}
        <SubmitAction
          header={header}
          submitPending={submit.isPending}
          describedBy={describedBy}
          onOpen={() => setDialogOpen(true)}
        />
        <ReviewStatusAction projectId={projectId} review={review} />
      </div>
      {header.submit && submissionThreads ? (
        <SubmitReviewDialog
          open={dialogOpen}
          storyId={review.story}
          reviewId={review.id}
          includedThreads={submissionThreads.included}
          notIncludedThreads={submissionThreads.notIncluded}
          destination={destination}
          onDestinationChange={setDestination}
          summary={summary}
          onSummaryChange={setSummary}
          assessStandards={assessStandards}
          hasCodingStandards={hasCodingStandards}
          onAssessStandardsChange={setAssessStandards}
          onOpenChange={closeDialog}
          onSubmit={() => {
            const trimmed = summary.trim();
            keepDraft.current = true;
            setDialogOpen(false);
            if (destination === "story") onAcknowledge();
            submit.mutate(
              {
                reviewId: review.id,
                destination,
                summary: trimmed === "" ? undefined : trimmed,
                ...(assessStandards && hasCodingStandards ? { assessStandards: true } : {}),
              },
              {
                onSuccess: () => {
                  resetDraft();
                  keepDraft.current = false;
                  onAcknowledgeEnd();
                },
                onError: () => {
                  keepDraft.current = false;
                  onAcknowledgeEnd();
                  setDialogOpen(true);
                },
              },
            );
          }}
        />
      ) : null}
      {reason ? (
        <p
          id="review-submit-merged-reason"
          data-testid="review-submit-merged"
          className="max-w-64 text-right text-xs text-muted-foreground"
        >
          {reason}
        </p>
      ) : null}
    </div>
  );
}
