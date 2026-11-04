import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import type { ReviewView } from "@server/schemas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CommentThread } from "@/features/issues/lib/comment-threads";
import { issueChannelPath } from "@/features/issues/lib/links";
import {
  useArchiveReview,
  useReopenReview,
  useRetryOpenReviewSubmissions,
  useSubmitReview,
} from "../api/mutations";
import type { ReviewSubmitHeader, ReviewTaskingStatus } from "../lib/review-submission-ui";
import { ReviewFollowUpIdeaButton } from "./review-follow-up-idea-button";
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

const TASKING_STATUS_CLASS = "h-8 gap-1.5 px-3 touch:h-11";

/** In-flight phases spin. The outline gate waits on the human, so it links there instead. */
function TaskingStatus({
  projectId,
  status,
}: {
  projectId: string;
  status: ReviewTaskingStatus;
}) {
  if (status.gateOutlineId) {
    return (
      <Link
        to={issueChannelPath(projectId, status.gateOutlineId, "planning")}
        className="rounded-md hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`${status.label}: open the outline's Planning tab`}
        data-testid="review-outline-gate-link"
      >
        <Badge
          variant="warn"
          className={`${TASKING_STATUS_CLASS} hover:border-[hsl(var(--rail-lit))]`}
          data-testid="review-tasking-status"
          role="status"
          aria-live="polite"
        >
          {status.label}
        </Badge>
      </Link>
    );
  }
  return (
    <Badge
      variant="inProgress"
      className={TASKING_STATUS_CLASS}
      data-testid="review-tasking-status"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden />
      {status.label}
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
  storyOpen,
  onAcknowledge,
  onAcknowledgeEnd,
  onRetryStart,
  onRetryEnd,
}: {
  projectId: string;
  review: ReviewView;
  header: ReviewSubmitHeader;
  /** Included and held-back threads; undefined until comments load. */
  submissionThreads:
    | { included: readonly CommentThread[]; notIncluded: readonly CommentThread[] }
    | undefined;
  /** False when the source Story is merged. */
  storyOpen: boolean;
  onAcknowledge: () => void;
  onAcknowledgeEnd: () => void;
  onRetryStart: (submissionIds: readonly string[]) => void;
  onRetryEnd: () => void;
}) {
  const submit = useSubmitReview(projectId);
  const retry = useRetryOpenReviewSubmissions(projectId);
  const [dialogOpen, setDialogOpen] = useState(false);

  const reason = header.submit?.reason ?? header.retry?.reason;
  const describedBy = reason ? "review-submit-merged-reason" : undefined;
  const retryAction = header.retry;
  const followUpStoryId =
    review.story && storyOpen && review.status !== "archived" ? review.story : undefined;

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
        {header.tasking ? <TaskingStatus projectId={projectId} status={header.tasking} /> : null}
        {followUpStoryId ? (
          <ReviewFollowUpIdeaButton projectId={projectId} storyId={followUpStoryId} />
        ) : null}
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
          reviewId={review.id}
          includedThreads={submissionThreads.included}
          notIncludedThreads={submissionThreads.notIncluded}
          onOpenChange={setDialogOpen}
          onSubmit={() => {
            setDialogOpen(false);
            onAcknowledge();
            submit.mutate(
              { reviewId: review.id },
              {
                onSuccess: () => {
                  onAcknowledgeEnd();
                },
                onError: () => {
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
