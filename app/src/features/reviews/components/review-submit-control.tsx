import { useRef, useState } from "react";
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
  acknowledgedSubmissions,
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
  summary,
  onSummaryChange,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  readyCount: number;
  summary: string;
  onSummaryChange: (summary: string) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            onChange={(event) => onSummaryChange(event.target.value)}
          />
        </DialogField>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            data-testid="submit-review-confirm"
            onClick={onSubmit}
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
  onAcknowledge,
  onAcknowledgeEnd,
  onRetryStart,
  onRetryEnd,
}: {
  projectId: string;
  review: ReviewView;
  header: ReviewSubmitHeader;
  onAcknowledge: () => void;
  onAcknowledgeEnd: () => void;
  onRetryStart: (submissionId: string) => void;
  onRetryEnd: () => void;
}) {
  const submit = useSubmitReview(projectId);
  const retry = useRetryReviewSubmission(projectId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const keepSummary = useRef(false);

  const closeDialog = (next: boolean) => {
    if (!next && !keepSummary.current) setSummary("");
    if (!next) keepSummary.current = false;
    setDialogOpen(next);
  };

  return (
    <div className="flex max-w-full flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <SubmitAction
          header={header}
          submitPending={submit.isPending}
          retryPending={retry.isPending}
          onRetry={(submissionId) => {
            onRetryStart(submissionId);
            retry.mutate(
              { reviewId: review.id, submissionId },
              {
                onSuccess: () => onRetryEnd(),
                onError: () => onRetryEnd(),
              },
            );
          }}
          onOpen={() => setDialogOpen(true)}
        />
        <ReviewStatusAction projectId={projectId} review={review} />
      </div>
      {header.mode === "submit" && header.readyCount !== undefined ? (
        <SubmitReviewDialog
          open={dialogOpen}
          readyCount={header.readyCount}
          summary={summary}
          onSummaryChange={setSummary}
          onOpenChange={closeDialog}
          onSubmit={() => {
            const trimmed = summary.trim();
            keepSummary.current = true;
            setDialogOpen(false);
            onAcknowledge();
            submit.mutate(
              { reviewId: review.id, summary: trimmed === "" ? undefined : trimmed },
              {
                onSuccess: () => {
                  setSummary("");
                  keepSummary.current = false;
                  onAcknowledgeEnd();
                },
                onError: () => {
                  keepSummary.current = false;
                  onAcknowledgeEnd();
                  setDialogOpen(true);
                },
              },
            );
          }}
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
  const readyThreads = loaded ? threads.filter((thread) => thread.readyToTask) : undefined;
  const readyCount = readyThreads?.length;
  const [pendingThreadIds, setPendingThreadIds] = useState<string[] | undefined>();
  const [retryingId, setRetryingId] = useState<string | undefined>();
  const header = review
    ? reviewSubmitHeader({
        merged,
        readyCount,
        submissions: acknowledgedSubmissions(
          review.submissions,
          pendingThreadIds,
          retryingId,
        ),
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
        <ReviewSubmitActions
          projectId={projectId}
          review={review}
          header={header}
          onAcknowledge={() =>
            setPendingThreadIds(readyThreads?.map((thread) => thread.root.id))
          }
          onAcknowledgeEnd={() => setPendingThreadIds(undefined)}
          onRetryStart={setRetryingId}
          onRetryEnd={() => setRetryingId(undefined)}
        />
      ) : null}
    </>
  );
}
