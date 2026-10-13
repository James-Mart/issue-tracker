import type { MouseEvent, ReactNode } from "react";
import { Link } from "react-router-dom";
import type { IssueDetail, ReviewProgress, ReviewRecordView } from "@server/schemas";
import { Button } from "@/components/ui/button";
import { CompactMetaItem } from "@/features/issues/components/compact-meta";
import { useIssuesWithArchived } from "@/features/issues/hooks/use-issues-with-archived";
import { useOpenReview } from "../api/mutations";
import { useReviewProgressQuery, useReviewsQuery } from "../api/queries";
import { useGoToReviewIssue } from "../hooks/use-go-to-review-issue";
import { reviewIssuePath } from "../lib/links";
import {
  storyCodeReviewLink,
  storyHasTaskCommits,
} from "../lib/story-review-entry";
import { ReviewProgressFault } from "./review-progress-fault";

type StoryDetail = Extract<IssueDetail, { kind: "story" }>;

function StoryCodeReviewLinkText({
  merged,
  review,
  progress,
}: {
  merged: boolean;
  review: ReviewRecordView | undefined;
  progress: ReviewProgress | undefined;
}) {
  if (!review) {
    return merged ? "Start post-mortem review" : "Start review";
  }
  if (!progress) {
    return review.status === "archived" ? <>Archived · Open</> : "Open";
  }
  const link = storyCodeReviewLink(review, progress);
  const count = (
    <span className="whitespace-nowrap font-mono text-[13px] tabular-nums">
      {link.reviewed} / {link.total}
    </span>
  );
  if (link.kind === "archived") {
    return (
      <>
        Archived · {count} · Open
      </>
    );
  }
  return (
    <>
      {count}
      <span className="whitespace-nowrap"> files reviewed · Open</span>
    </>
  );
}

function StoryCodeReviewReady({
  projectId,
  merged,
  review,
}: {
  projectId: string;
  merged: boolean;
  review: ReviewRecordView;
}) {
  const progress = useReviewProgressQuery(projectId, review.id);
  return (
    <>
      <Button asChild variant="link" size="sm" className="h-auto px-0 py-0 font-normal">
        <Link to={reviewIssuePath(projectId, review.id)} data-testid="story-code-review-link">
          <StoryCodeReviewLinkText
            merged={merged}
            review={review}
            progress={progress.data}
          />
        </Link>
      </Button>
      {progress.error ? <ReviewProgressFault /> : null}
    </>
  );
}

export function StoryCodeReviewRow({
  projectId,
  story,
}: {
  projectId: string;
  story: StoryDetail;
}) {
  const { data: issues } = useIssuesWithArchived(true);
  const hasCommits = storyHasTaskCommits(story.id, issues?.issues ?? []);
  const reviews = useReviewsQuery(projectId, story.id, { enabled: hasCommits });
  const review = reviews.data?.reviews[0];
  const open = useOpenReview(projectId);
  const goToReview = useGoToReviewIssue(projectId);

  if (!hasCommits) return null;

  const start = (event: MouseEvent<HTMLButtonElement>) => {
    if (open.isPending) return;
    const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    void open.mutateAsync(story.id).then(
      (created) => {
        goToReview(created.id, modified);
      },
      () => {
        // useOpenReview already toasts; stay on Story detail.
      },
    );
  };

  let value: ReactNode;
  if (reviews.error) {
    value = (
      <span className="text-destructive">
        Could not load the review. Reload the page.
      </span>
    );
  } else if (reviews.isPending) {
    value = <span className="text-muted-foreground">Loading review…</span>;
  } else if (review) {
    value = (
      <StoryCodeReviewReady projectId={projectId} merged={story.merged} review={review} />
    );
  } else {
    value = (
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto px-0 py-0 font-normal"
        data-testid="story-code-review-link"
        aria-busy={open.isPending || undefined}
        disabled={open.isPending}
        onClick={start}
      >
        <StoryCodeReviewLinkText merged={story.merged} review={undefined} progress={undefined} />
      </Button>
    );
  }

  return <CompactMetaItem label="Code review" value={value} />;
}
