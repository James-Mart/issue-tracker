import type { IssueRecord, ReviewProgress, ReviewRecordView } from "@server/schemas";
import { storyTasksForRail } from "@/features/issues/lib/story-task-rail";

/**
 * A Story has Task commits when one of its own Tasks records a sha and is
 * not `noDiff` — the same set the Story diff walks.
 */
export function storyHasTaskCommits(
  storyId: string,
  issues: readonly IssueRecord[],
): boolean {
  return storyTasksForRail(storyId, issues).some(
    (task) => !task.noDiff && task.commits.length > 0,
  );
}

export type StoryCodeReviewLink =
  | { kind: "open"; reviewed: number; total: number }
  | { kind: "archived"; reviewed: number; total: number };

/** Count label for a review whose progress has loaded. */
export function storyCodeReviewLink(
  review: ReviewRecordView,
  progress: ReviewProgress,
): StoryCodeReviewLink {
  const { reviewed, total } = progress.all;
  if (review.effectiveStatus === "archived") {
    return { kind: "archived", reviewed, total };
  }
  return { kind: "open", reviewed, total };
}
