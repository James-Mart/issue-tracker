import type { IssueRecord, ReviewView } from "@server/schemas";
import { filterToProject } from "@/features/issues/lib/build-tree";
import { formatRelativeUpdatedAt } from "@/features/issues/lib/format-relative-updated-at";
import { storyTasksForRail } from "@/features/issues/lib/story-task-rail";

type StoryRecord = Extract<IssueRecord, { kind: "story" }>;
type ArchivedReview = Extract<ReviewView, { effectiveStatus: "archived" }>;

export type ReviewHomeReview = {
  review: ReviewView;
  story: StoryRecord | undefined;
};

export type ReviewHomeReady = {
  story: StoryRecord;
  taskCount: number;
};

export type ReviewHomeArchived = {
  review: ArchivedReview;
  story: StoryRecord | undefined;
};

export type ReviewMetaPart = {
  text: string;
  tone?: "mono" | "warn";
};

export type ReviewHomeLists = {
  open: ReviewHomeReview[];
  ready: ReviewHomeReady[];
  archived: ReviewHomeArchived[];
};

function byUpdatedDesc<T extends { id: string; updatedAt: string }>(
  a: T,
  b: T,
): number {
  const byTime = b.updatedAt.localeCompare(a.updatedAt);
  return byTime === 0 ? a.id.localeCompare(b.id) : byTime;
}

function storiesInProject(issues: readonly IssueRecord[]): StoryRecord[] {
  return issues.filter((issue): issue is StoryRecord => issue.kind === "story");
}

/** Unmerged, at least one Task, every Task done, and no review record yet. */
function readyTaskCount(
  story: StoryRecord,
  issues: readonly IssueRecord[],
  reviewedStoryIds: ReadonlySet<string>,
): number | undefined {
  if (story.merged || reviewedStoryIds.has(story.id)) return undefined;
  const tasks = storyTasksForRail(story.id, issues);
  if (tasks.length === 0 || !tasks.every((task) => task.status === "done")) {
    return undefined;
  }
  return tasks.length;
}

/**
 * Open reviews are effectively open (unmerged Stories, plus post-mortems).
 * Ready is unmerged Stories whose Tasks are all done and that have no review.
 * Archived is effectively archived, including a merged Story's non-post-mortem.
 */
export function reviewHomeLists(
  projectId: string,
  issues: readonly IssueRecord[],
  reviews: readonly ReviewView[],
): ReviewHomeLists {
  const projectIssues = filterToProject(issues, projectId);
  const stories = storiesInProject(projectIssues);
  const storyById = new Map(stories.map((story) => [story.id, story]));
  const reviewedStoryIds = new Set(
    reviews.map((review) => review.target.storyId),
  );
  const withStory = (review: ReviewView): ReviewHomeReview => ({
    review,
    story: storyById.get(review.target.storyId),
  });

  return {
    open: reviews
      .filter((review) => review.effectiveStatus === "open")
      .map(withStory)
      .sort((a, b) => byUpdatedDesc(a.review, b.review)),
    ready: stories
      .flatMap((story) => {
        const taskCount = readyTaskCount(story, projectIssues, reviewedStoryIds);
        return taskCount === undefined ? [] : [{ story, taskCount }];
      })
      .sort((a, b) => byUpdatedDesc(a.story, b.story)),
    archived: reviews
      .filter((review): review is ArchivedReview => review.effectiveStatus === "archived")
      .map((review) => ({
        review,
        story: storyById.get(review.target.storyId),
      }))
      .sort((a, b) => byUpdatedDesc(a.review, b.review)),
  };
}

function updatedClause(iso: string, nowMs: number): ReviewMetaPart[] {
  return [
    { text: "Updated " },
    { text: formatRelativeUpdatedAt(iso, nowMs), tone: "mono" },
  ];
}

function progressClause(reviewed: number, total: number): ReviewMetaPart[] {
  return [
    { text: `${reviewed} / ${total}`, tone: "mono" },
    { text: " files reviewed" },
  ];
}

export function openReviewMeta(
  review: ReviewView,
  nowMs: number = Date.now(),
): ReviewMetaPart[][] {
  const { reviewed, total, changedSinceReviewed } = review.progress.all;
  const clauses = [progressClause(reviewed, total)];
  if (changedSinceReviewed.length > 0) {
    clauses.push([
      { text: String(changedSinceReviewed.length), tone: "warn" },
      { text: " changed since reviewed", tone: "warn" },
    ]);
  }
  clauses.push(updatedClause(review.updatedAt, nowMs));
  return clauses;
}

export function readyReviewMeta(
  taskCount: number,
  updatedAt: string,
  nowMs: number = Date.now(),
): ReviewMetaPart[][] {
  return [
    [
      { text: String(taskCount), tone: "mono" },
      { text: taskCount === 1 ? " task done" : " tasks done" },
    ],
    updatedClause(updatedAt, nowMs),
  ];
}

export function archivedReviewMeta(
  review: ArchivedReview,
  nowMs: number = Date.now(),
): ReviewMetaPart[][] {
  const { reviewed, total } = review.progress.all;
  const reason = review.archivedReason === "merged" ? "Story merged" : "Archived";
  return [progressClause(reviewed, total), [{ text: reason }], updatedClause(review.updatedAt, nowMs)];
}
