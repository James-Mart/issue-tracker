import type { MouseEvent, ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { IssueDetail, ReviewProgress, ReviewRecordView } from "@server/schemas";
import { CompactMetaItem } from "@/features/issues/components/compact-meta";
import { useIssuesWithArchived } from "@/features/issues/hooks/use-issues-with-archived";
import { useOpenReview } from "../api/mutations";
import { useReviewProgressQuery, useReviewsQuery } from "../api/queries";
import { storyReviewPath } from "../lib/links";
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
    return review.effectiveStatus === "archived" ? <>Archived · Open</> : "Open";
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
  href,
  pending,
  onClick,
}: {
  projectId: string;
  merged: boolean;
  review: ReviewRecordView;
  href: string;
  pending: boolean;
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const progress = useReviewProgressQuery(projectId, review.id);
  return (
    <>
      <Link
        to={href}
        className="text-primary hover:underline"
        data-testid="story-code-review-link"
        aria-busy={pending || undefined}
        onClick={onClick}
      >
        <StoryCodeReviewLinkText
          merged={merged}
          review={review}
          progress={progress.data}
        />
      </Link>
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
  const navigate = useNavigate();

  if (!hasCommits) return null;

  const href = storyReviewPath(projectId, story.id);
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (open.isPending) {
      event.preventDefault();
      return;
    }
    const modified =
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey;
    if (modified) {
      void open.mutate(story.id);
      return;
    }
    event.preventDefault();
    void open.mutateAsync(story.id).then(
      () => navigate(href),
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
  } else {
    value = review ? (
      <StoryCodeReviewReady
        projectId={projectId}
        merged={story.merged}
        review={review}
        href={href}
        pending={open.isPending}
        onClick={onClick}
      />
    ) : (
      <Link
        to={href}
        className="text-primary hover:underline"
        data-testid="story-code-review-link"
        aria-busy={open.isPending || undefined}
        onClick={onClick}
      >
        <StoryCodeReviewLinkText merged={story.merged} review={undefined} progress={undefined} />
      </Link>
    );
  }

  return <CompactMetaItem label="Code review" value={value} />;
}
