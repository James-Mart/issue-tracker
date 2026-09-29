import type { IssueRecord, ReviewView } from "@server/schemas";
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
  | { kind: "start"; text: "Start review" | "Start post-mortem review" }
  | { kind: "open"; reviewed: number; total: number }
  | { kind: "archived"; reviewed: number; total: number };

/** Which Code review link the Story detail row shows. */
export function storyCodeReviewLink(
  merged: boolean,
  review: ReviewView | undefined,
): StoryCodeReviewLink {
  if (!review) {
    return {
      kind: "start",
      text: merged ? "Start post-mortem review" : "Start review",
    };
  }
  const { reviewed, total } = review.progress.all;
  if (review.effectiveStatus === "archived") {
    return { kind: "archived", reviewed, total };
  }
  return { kind: "open", reviewed, total };
}
