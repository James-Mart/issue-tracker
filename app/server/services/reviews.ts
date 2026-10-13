import { nextSiblingOrder } from "../order.js";
import { parseIssue, type Issue } from "../schemas/issue.js";
import {
  parseOpenReviewBody,
  type ReviewIssue,
  type ReviewRecordView,
} from "../schemas/review.js";
import { collectDescendantCommits } from "./change.js";
import { IssueError } from "./errors.js";
import { problemsFor } from "./integrity.js";
import {
  commitIssueBatch,
  ensureMigrations,
  readAll,
  readIssueOrThrow,
  serialize,
  update,
} from "./issues.js";
import { withIssuesStoreLock } from "./issues-store-lock.js";
import { compareReviewsByCreated, reviewLifecycle } from "./review-lifecycle.js";
import { presentSubmissions } from "./review-submission-threads.js";
import { requireProject } from "./require-project.js";
import { uniqueSlug } from "./slug.js";
import { assertStoreWritable } from "./store-read-only.js";
import { ancestorChain } from "./subtree.js";

type Story = Extract<Issue, { kind: "story" }>;

export function requireStoryInProject(
  projectId: string,
  storyId: string,
  issues?: Issue[],
): Story {
  const graph = issues ?? readAll().issues;
  const found = graph.find((issue) => issue.id === storyId);
  const story = found ?? readIssueOrThrow(storyId);
  if (story.kind !== "story") {
    throw new IssueError(
      "validation",
      `target "${storyId}" is not a story`,
    );
  }
  const project = ancestorChain(storyId, graph)[0]!;
  if (project.id !== projectId) {
    throw new IssueError(
      "validation",
      `story "${storyId}" is outside project "${projectId}"`,
    );
  }
  return story;
}

function assertStoryHasTaskCommits(storyId: string): void {
  if (collectDescendantCommits(storyId).length === 0) {
    throw new IssueError(
      "validation",
      `story "${storyId}" has no task commits`,
    );
  }
}

function requireReview(
  projectId: string,
  reviewId: string,
  issues: readonly Issue[],
): ReviewIssue {
  const issue = issues.find((candidate) => candidate.id === reviewId);
  if (!issue) throw new IssueError("not_found", `unknown review "${reviewId}"`);
  if (issue.kind !== "review") {
    throw new IssueError("validation", `"${reviewId}" is not a review`);
  }
  if (issue.partOf !== projectId) {
    throw new IssueError(
      "validation",
      `review "${reviewId}" belongs to project "${issue.partOf}"`,
    );
  }
  return issue;
}

function reviewOfStory(
  projectId: string,
  storyId: string,
  issues: readonly Issue[],
): ReviewIssue | undefined {
  const review = storedReviewForStory(storyId, issues);
  return review?.partOf === projectId ? review : undefined;
}

function storyForReview(review: ReviewIssue, byId: ReadonlyMap<string, Issue>): Story {
  const story = byId.get(review.story);
  if (story?.kind !== "story") {
    throw new IssueError(
      "validation",
      `review story "${review.story}" is not a story`,
    );
  }
  return story;
}

function toView(
  review: ReviewIssue,
  issues: Issue[],
  byId: ReadonlyMap<string, Issue> = new Map(issues.map((issue) => [issue.id, issue])),
): ReviewRecordView {
  return {
    ...review,
    ...reviewLifecycle(review, storyForReview(review, byId)),
    submissions: presentSubmissions(review, issues),
  };
}

export function listReviewViews(
  projectId: string,
  storyId?: string,
  issues?: Issue[],
): { reviews: ReviewRecordView[] } {
  const id = requireProject(projectId);
  const graph = issues ?? readAll().issues;
  if (storyId !== undefined) {
    const review = reviewOfStory(id, storyId, graph);
    return { reviews: review ? [toView(review, graph)] : [] };
  }
  const byId = new Map(graph.map((issue) => [issue.id, issue]));
  const reviews = graph
    .filter((issue): issue is ReviewIssue => issue.kind === "review" && issue.partOf === id)
    .sort(compareReviewsByCreated);
  return { reviews: reviews.map((review) => toView(review, graph, byId)) };
}

/** The review issue whose source is this Story, without the read-model fields. */
export function storedReviewForStory(
  storyId: string,
  issues: readonly Issue[] = readAll().issues,
): ReviewIssue | undefined {
  return issues.find(
    (issue): issue is ReviewIssue => issue.kind === "review" && issue.story === storyId,
  );
}

export function readReviewView(
  projectId: string,
  reviewId: string,
  issues?: Issue[],
): ReviewRecordView {
  const id = requireProject(projectId);
  const graph = issues ?? readAll().issues;
  return toView(requireReview(id, reviewId, graph), graph);
}

/** A new, unwritten review of a Story, with an id none of `takenIds` uses. */
export function buildReviewIssue(
  story: Story,
  projectId: string,
  issues: Issue[],
  takenIds: Iterable<string>,
  { archived, now }: { archived: boolean; now: string },
): ReviewIssue {
  const parsed = parseIssue({
    id: uniqueSlug(`${story.id}-review`, takenIds),
    kind: "review",
    partOf: projectId,
    title: story.title,
    story: story.id,
    archived,
    marks: { all: {}, commits: {} },
    submissions: [],
    order: nextSiblingOrder(issues, "review", projectId, undefined),
    createdAt: now,
    updatedAt: now,
  });
  if (!parsed.ok) throw new IssueError("validation", parsed.message);
  if (parsed.issue.kind !== "review") {
    throw new IssueError("validation", `"${parsed.issue.id}" is not a review`);
  }
  return parsed.issue;
}

function startReview(
  projectId: string,
  storyId: string,
): Promise<{ created: boolean; review: ReviewRecordView }> {
  return serialize(() => {
    ensureMigrations();
    const { issues } = readAll();
    const story = requireStoryInProject(projectId, storyId, issues);
    // A review stays the story's review after its task commits are gone.
    const existing = reviewOfStory(projectId, storyId, issues);
    if (existing) return { created: false, review: toView(existing, issues) };
    assertStoryHasTaskCommits(storyId);
    const review = buildReviewIssue(
      story,
      projectId,
      issues,
      issues.map((issue) => issue.id),
      { archived: false, now: new Date().toISOString() },
    );
    const graph = [...issues, review];
    const problems = problemsFor(review.id, graph);
    if (problems.length > 0) {
      throw new IssueError("validation", problems.map((p) => p.message).join("; "));
    }
    commitIssueBatch([{ issue: review }], []);
    return { created: true, review: toView(review, graph) };
  });
}

/** Start a review of a Story in this Project, or return the one it already has. */
export function openOrCreateReview(
  projectId: string,
  body: unknown,
): Promise<{ created: boolean; review: ReviewRecordView }> {
  const parsed = parseOpenReviewBody(body);
  if (!parsed.ok) throw new IssueError("validation", parsed.message);
  return startReview(requireProject(projectId), parsed.body.story);
}

/** Start a review of a Story, or return the one it already has. */
export function startStoryReview(
  storyId: string,
): Promise<{ created: boolean; review: ReviewRecordView }> {
  const projectId = ancestorChain(storyId, readAll().issues)[0]!.id;
  return startReview(projectId, storyId);
}

async function setReviewArchived(
  projectId: string,
  reviewId: string,
  archived: boolean,
): Promise<ReviewRecordView> {
  requireReview(requireProject(projectId), reviewId, readAll().issues);
  await update(reviewId, { archived });
  return readReviewView(projectId, reviewId);
}

export function archiveReview(projectId: string, reviewId: string): Promise<ReviewRecordView> {
  return setReviewArchived(projectId, reviewId, true);
}

export function reopenReview(projectId: string, reviewId: string): Promise<ReviewRecordView> {
  return setReviewArchived(projectId, reviewId, false);
}

/**
 * Replace a review issue under the store lock.
 * `mutate` returns the same object to leave the file untouched.
 */
export function updateStoredReview(
  projectId: string,
  reviewId: string,
  mutate: (current: ReviewIssue, view: ReviewRecordView) => ReviewIssue,
  issues?: Issue[],
): ReviewRecordView {
  assertStoreWritable();
  return withIssuesStoreLock(() => {
    const id = requireProject(projectId);
    const fresh = readAll().issues;
    const review = requireReview(id, reviewId, fresh);
    const graph = issues ?? fresh;
    const byId = new Map(graph.map((issue) => [issue.id, issue]));
    const view = toView(review, graph, byId);
    const next = mutate(review, view);
    if (next === review) return view;
    const parsed = parseIssue(next);
    if (!parsed.ok) throw new IssueError("validation", parsed.message);
    commitIssueBatch([{ issue: parsed.issue }], []);
    return toView(next, graph, byId);
  });
}
