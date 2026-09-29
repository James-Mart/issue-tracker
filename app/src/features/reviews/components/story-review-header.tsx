import { Link } from "react-router-dom";
import type { ReviewCommits, ReviewView } from "@server/schemas";
import { Button } from "@/components/ui/button";
import { issuePath } from "@/features/issues/lib/links";
import { useArchiveReview, useReopenReview } from "../api/mutations";
import { shortSha } from "@/lib/utils/short-sha";

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
      size="sm"
      className="shrink-0"
      disabled={archive.isPending}
      onClick={() => archive.mutate(review.id)}
    >
      Archive
    </Button>
  );
}

function CommitMeta({ commits }: { commits: ReviewCommits }) {
  const count = commits.commits.length;
  return (
    <>
      <span data-testid="review-merge-base">
        Merge base <span className="text-foreground">{commits.mergeBaseRef}</span>
      </span>
      {count > 0 ? (
        <>
          <span>{count === 1 ? "1 commit" : `${count} commits`}</span>
          <span title={commits.tip}>
            tip <span className="text-foreground">{shortSha(commits.tip)}</span>
          </span>
        </>
      ) : null}
    </>
  );
}

export function StoryReviewHeader({
  projectId,
  storyId,
  storyTitle,
  review,
  commits,
}: {
  projectId: string;
  storyId: string;
  storyTitle: string;
  review?: ReviewView;
  commits?: ReviewCommits;
}) {
  return (
    <header className="shrink-0" data-testid="story-review-header">
      <p className="font-display text-[11px] font-semibold uppercase tracking-[0.22em] text-[hsl(var(--current))]">
        Story review
      </p>
      <div className="mt-1 flex items-start justify-between gap-3">
        <h1 className="min-w-0 text-xl font-semibold leading-snug tracking-tight text-foreground">
          {storyTitle}
        </h1>
        {review ? <ReviewStatusAction projectId={projectId} review={review} /> : null}
      </div>
      <p className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 font-mono text-xs tabular-nums text-muted-foreground">
        <Link
          to={issuePath(projectId, storyId)}
          className="text-[hsl(var(--current))] hover:underline"
          data-testid="review-story-link"
        >
          {storyId}
        </Link>
        {commits ? <CommitMeta commits={commits} /> : null}
      </p>
    </header>
  );
}
