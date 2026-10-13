import type { ReviewWorktreeSyncHold } from "@server/schemas";
import { Button } from "@/components/ui/button";
import { useSyncReviewWorktree } from "../api/mutations";

export function reviewTipSyncLead(newCommits: number): string {
  return newCommits === 1 ? "1 new commit on" : `${newCommits} new commits on`;
}

/** One left-aligned row: the commit count, the branch, then Update now. */
export function ReviewTipSyncNotice({
  projectId,
  reviewId,
  hold,
}: {
  projectId: string;
  reviewId: string;
  hold: ReviewWorktreeSyncHold;
}) {
  const sync = useSyncReviewWorktree(projectId);
  return (
    <div
      className="mt-2 flex w-full flex-wrap items-center justify-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
      data-testid="review-tip-sync"
      role="status"
    >
      <p className="[color:hsl(var(--warning))]">
        {reviewTipSyncLead(hold.newCommits)} <code className="font-mono">{hold.ref}</code>
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="shrink-0"
        data-testid="review-tip-sync-update"
        disabled={sync.isPending}
        onClick={() => sync.mutate(reviewId)}
      >
        Update now
      </Button>
    </div>
  );
}
