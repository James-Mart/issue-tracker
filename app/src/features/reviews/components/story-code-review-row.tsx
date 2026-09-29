import type { MouseEvent, ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { IssueDetail, ReviewView } from "@server/schemas";
import { CompactMetaItem } from "@/features/issues/components/compact-meta";
import { useIssuesQuery } from "@/features/issues/api/queries";
import { useOpenReview } from "../api/mutations";
import { useReviewsQuery } from "../api/queries";
import { storyReviewPath } from "../lib/links";
import {
  storyCodeReviewLink,
  storyHasTaskCommits,
} from "../lib/story-review-entry";

type StoryDetail = Extract<IssueDetail, { kind: "story" }>;

function StoryCodeReviewLinkText({
  merged,
  review,
}: {
  merged: boolean;
  review: ReviewView | undefined;
}) {
  const link = storyCodeReviewLink(merged, review);
  if (link.kind === "start") return link.text;
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

export function StoryCodeReviewRow({
  projectId,
  story,
}: {
  projectId: string;
  story: StoryDetail;
}) {
  const { data: issues } = useIssuesQuery();
  const hasCommits = storyHasTaskCommits(story.id, issues?.issues ?? []);
  const reviews = useReviewsQuery(projectId, story.id, { enabled: hasCommits });
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

  const review = reviews.data?.reviews[0];
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
    value = (
      <Link
        to={href}
        className="text-primary hover:underline"
        data-testid="story-code-review-link"
        aria-busy={open.isPending || undefined}
        onClick={onClick}
      >
        <StoryCodeReviewLinkText merged={story.merged} review={review} />
      </Link>
    );
  }

  return <CompactMetaItem label="Code review" value={value} />;
}
