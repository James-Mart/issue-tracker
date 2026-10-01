import { useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
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
import {
  useArchiveReview,
  useReopenReview,
  useRetryOpenReviewSubmissions,
  useSubmitReview,
} from "../api/mutations";
import {
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
  onRetryStart: (submissionIds: readonly string[]) => void;
  onRetryEnd: () => void;
}) {
  const submit = useSubmitReview(projectId);
  const retry = useRetryOpenReviewSubmissions(projectId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const keepSummary = useRef(false);

  const closeDialog = (next: boolean) => {
    if (!next && !keepSummary.current) setSummary("");
    if (!next) keepSummary.current = false;
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
      {header.submit && header.submit.readyCount !== undefined ? (
        <SubmitReviewDialog
          open={dialogOpen}
          readyCount={header.submit.readyCount}
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
