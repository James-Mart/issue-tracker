import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import type { ReviewCommits, ReviewView } from "@server/schemas";
import type { CommentThread } from "@/features/issues/lib/comment-threads";
import { projectReviewPath } from "../lib/links";
import { ReviewHeaderBody } from "./review-header-body";

export function StoryReviewHeader({
  projectId,
  storyId,
  storyTitle,
  review,
  commits,
  merged,
  onOpenThread,
}: {
  projectId: string;
  storyId: string;
  storyTitle: string;
  review?: ReviewView;
  commits?: ReviewCommits;
  merged: boolean;
  onOpenThread?: (thread: CommentThread) => void;
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
      <ReviewHeaderBody
        projectId={projectId}
        storyId={storyId}
        title={storyTitle}
        review={review}
        commits={commits}
        merged={merged}
        onOpenThread={onOpenThread}
      />
    </header>
  );
}
