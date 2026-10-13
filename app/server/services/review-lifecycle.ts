import type { Issue } from "../schemas.js";
import type { ReviewLifecycle } from "../schemas/review.js";

export type IssueTransition = { before: Issue; after: Issue };

export function reviewStatus(review: { archived: boolean }): ReviewLifecycle["status"] {
  return review.archived ? "archived" : "open";
}

export function reviewLifecycle(
  review: { archived: boolean },
  story: { merged: boolean },
): ReviewLifecycle {
  if (!review.archived) return { status: "open" };
  return { status: "archived", archivedReason: story.merged ? "merged" : "explicit" };
}

/** Reviews list oldest first. */
export function compareReviewsByCreated(
  a: { createdAt: string; id: string },
  b: { createdAt: string; id: string },
): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

function storyCloses({ before, after }: IssueTransition): boolean {
  if (before.kind !== "story" || after.kind !== "story") return false;
  return (after.merged && !before.merged) || (after.archived && !before.archived);
}

/** Open reviews of every Story that `transitions` merges or archives, archived at `now`. */
export function archiveReviewsOfClosingStories(
  transitions: readonly IssueTransition[],
  issues: readonly Issue[],
  now: string,
): Issue[] {
  const closing = new Set(transitions.filter(storyCloses).map(({ after }) => after.id));
  if (closing.size === 0) return [];
  return issues.flatMap((issue) =>
    issue.kind === "review" &&
    issue.story !== undefined &&
    !issue.archived &&
    closing.has(issue.story)
      ? [{ ...issue, archived: true, updatedAt: now }]
      : [],
  );
}
