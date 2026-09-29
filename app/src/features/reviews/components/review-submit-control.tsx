import { useState } from "react";
import { CircleAlert, Loader2, RefreshCw } from "lucide-react";
import type { ReviewView } from "@server/schemas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogField,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCommentThreads } from "@/features/issues/api/queries";
import {
  useArchiveReview,
  useReopenReview,
  useRetryReviewSubmission,
  useSubmitReview,
} from "../api/mutations";
import {
  reviewSubmitHeader,
  submitReviewDialogDetail,
  type ReviewSubmitHeader,
} from "../lib/review-submission-ui";

function ReviewStatusAction({
  projectId,
  review,
}: {
  projectId: string;
  review: ReviewView;
}) {
  const archive = useArchiveReview(projectId);
  const reopen = useReopenReview(projectId);
  if (review.effectiveStatus === "archived") {
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

function SubmitReviewDialog({
  open,
  readyCount,
  pending,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  readyCount: number;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (summary: string | undefined) => void;
}) {
  const [summary, setSummary] = useState("");
  const close = (next: boolean) => {
    if (!next) setSummary("");
    onOpenChange(next);
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent data-testid="submit-review-dialog">
        <DialogHeader>
          <DialogTitle>Submit review</DialogTitle>
          <DialogDescription>{submitReviewDialogDetail(readyCount)}</DialogDescription>
        </DialogHeader>
        <DialogField>
          <Label htmlFor="submit-review-summary">Summary comment (optional)</Label>
          <Textarea
            id="submit-review-summary"
            value={summary}
            data-testid="submit-review-summary"
            disabled={pending}
            onChange={(event) => setSummary(event.target.value)}
          />
        </DialogField>
        <DialogFooter>
          <Button type="button" onClick={() => close(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            data-testid="submit-review-confirm"
            disabled={pending}
            onClick={() => {
              const trimmed = summary.trim();
              onSubmit(trimmed === "" ? undefined : trimmed);
            }}
          >
            Submit review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SubmitAction({
  header,
  submitPending,
  retryPending,
  onRetry,
  onOpen,
}: {
  header: ReviewSubmitHeader;
  submitPending: boolean;
  retryPending: boolean;
  onRetry: (submissionId: string) => void;
  onOpen: () => void;
}) {
  switch (header.mode) {
    case "tasking":
      return (
        <Badge
          variant="inProgress"
          className="h-8 gap-1.5 px-3 touch:h-11"
          data-testid="review-tasking-status"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden />
          {header.label}
        </Badge>
      );
    case "failed":
      return (
        <Button
          type="button"
          size="sm"
          variant="current"
          className="shrink-0"
          disabled={header.retryDisabled || retryPending}
          aria-describedby={header.reason ? "review-submit-merged-reason" : undefined}
          data-testid="review-submission-retry"
          onClick={() => onRetry(header.submissionId)}
        >
          <RefreshCw aria-hidden />
          Retry
        </Button>
      );
    case "submit":
      return (
        <Button
          type="button"
          size="sm"
          variant="primary"
          className="shrink-0"
          disabled={header.disabled || submitPending}
          aria-describedby={header.reason ? "review-submit-merged-reason" : undefined}
          data-testid="submit-review"
          data-ready-count={header.readyCount ?? ""}
          onClick={onOpen}
        >
          {header.label}
        </Button>
      );
  }
}

function ReviewSubmitActions({
  projectId,
  review,
  header,
}: {
  projectId: string;
  review: ReviewView;
  header: ReviewSubmitHeader;
}) {
  const submit = useSubmitReview(projectId);
  const retry = useRetryReviewSubmission(projectId);
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="flex max-w-full flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <SubmitAction
          header={header}
          submitPending={submit.isPending}
          retryPending={retry.isPending}
          onRetry={(submissionId) => retry.mutate({ reviewId: review.id, submissionId })}
          onOpen={() => setDialogOpen(true)}
        />
        <ReviewStatusAction projectId={projectId} review={review} />
      </div>
      {header.mode === "submit" && header.readyCount !== undefined ? (
        <SubmitReviewDialog
          open={dialogOpen}
          readyCount={header.readyCount}
          pending={submit.isPending}
          onOpenChange={setDialogOpen}
          onSubmit={(summary) =>
            submit.mutate(
              { reviewId: review.id, summary },
              { onSuccess: () => setDialogOpen(false) },
            )
          }
        />
      ) : null}
      {header.mode !== "tasking" && header.reason ? (
        <p
          id="review-submit-merged-reason"
          data-testid="review-submit-merged"
          className="max-w-64 text-right text-xs text-muted-foreground"
        >
          {header.reason}
        </p>
      ) : null}
    </div>
  );
}

/** Title column and submit cluster, from one header-state value. */
export function ReviewSubmitColumns({
  projectId,
  storyId,
  storyTitle,
  review,
  merged,
}: {
  projectId: string;
  storyId: string;
  storyTitle: string;
  review?: ReviewView;
  merged: boolean;
}) {
  const { threads, loaded } = useCommentThreads(storyId);
  const readyCount = loaded
    ? threads.filter((thread) => thread.readyToTask).length
    : undefined;
  const header = review
    ? reviewSubmitHeader({
        merged,
        readyCount,
        submissions: review.submissions,
      })
    : undefined;

  return (
    <>
      <div className="min-w-0">
        <h1 className="min-w-0 text-xl font-semibold leading-snug tracking-tight text-foreground">
          {storyTitle}
        </h1>
        {header?.mode === "failed" ? (
          <p
            className="mt-1 flex items-start gap-1.5 text-sm text-destructive"
            data-testid="review-tasking-error"
            role="status"
          >
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{header.error}</span>
          </p>
        ) : null}
      </div>
      {review && header ? (
        <ReviewSubmitActions projectId={projectId} review={review} header={header} />
      ) : null}
    </>
  );
}
