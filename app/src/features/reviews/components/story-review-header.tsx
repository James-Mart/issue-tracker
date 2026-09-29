import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import type { ReviewCommits, ReviewView } from "@server/schemas";
import { issuePath } from "@/features/issues/lib/links";
import { shortSha } from "@/lib/utils/short-sha";
import { projectReviewPath } from "../lib/links";
import { ReviewSubmitColumns } from "./review-submit-control";

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
  merged,
}: {
  projectId: string;
  storyId: string;
  storyTitle: string;
  review?: ReviewView;
  commits?: ReviewCommits;
  merged: boolean;
}) {
  return (
    <header className="shrink-0" data-testid="story-review-header">
      <Link
        to={projectReviewPath(projectId)}
        aria-label="Back to code review"
        data-testid="review-back-to-home"
        className="mb-3 flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Code review
      </Link>
      <p className="font-display text-[11px] font-semibold uppercase tracking-[0.22em] text-[hsl(var(--current))]">
        Story review
      </p>
      <div className="mt-1 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <ReviewSubmitColumns
          projectId={projectId}
          storyId={storyId}
          storyTitle={storyTitle}
          review={review}
          merged={merged}
        />
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
