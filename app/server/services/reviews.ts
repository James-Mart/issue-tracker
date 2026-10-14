import { nextSiblingOrder } from "../order.js";
import { parseIssue, type Issue } from "../schemas/issue.js";
import {
  parseOpenReviewBody,
  type ReviewIssue,
  type ReviewRecordView,
} from "../schemas/review.js";
import type { ReviewPrSource } from "../schemas/review-state.js";
import { collectDescendantCommits } from "./change.js";
import { parsePrUrl } from "./delivery.js";
import { IssueError } from "./errors.js";
import {
  assertGuestAllowsOutwardEffect,
  GUEST_REFUSED_REVIEW_WORKTREE_CREATE,
} from "./guest-outward-effects.js";
import {
  attemptReviewWorktreeRemoval,
  ensureReviewWorktree,
} from "./review-worktree.js";
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
import { resolveReviewPr, type ResolvedReviewPr } from "./review-pr.js";
import { requireProject } from "./require-project.js";
import { uniqueSlug } from "./slug.js";
import { assertStoreWritable } from "./store-read-only.js";
import { ancestorChain, subtreeIds } from "./subtree.js";

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
  const storyId = requireReviewStory(review);
  const story = byId.get(storyId);
  if (story?.kind !== "story") {
    throw new IssueError("validation", `review story "${storyId}" is not a story`);
  }
  return story;
}

function reviewLifecycleFor(
  review: ReviewIssue,
  byId: ReadonlyMap<string, Issue>,
): ReturnType<typeof reviewLifecycle> {
  if (!review.story) {
    return review.archived
      ? { status: "archived", archivedReason: "explicit" }
      : { status: "open" };
  }
  return reviewLifecycle(review, storyForReview(review, byId));
}

function toView(
  review: ReviewIssue,
  issues: Issue[],
  byId: ReadonlyMap<string, Issue> = new Map(issues.map((issue) => [issue.id, issue])),
): ReviewRecordView {
  return {
    ...review,
    ...reviewLifecycleFor(review, byId),
    submissions: presentSubmissions(review, issues),
  };
}

export function requireReviewStory(review: { id: string; story?: string }): string {
  if (!review.story) {
    throw new IssueError("validation", `review "${review.id}" has no story`);
  }
  return review.story;
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

function parsedReview(fields: Parameters<typeof parseIssue>[0]): ReviewIssue {
  const parsed = parseIssue(fields);
  if (!parsed.ok) throw new IssueError("validation", parsed.message);
  if (parsed.issue.kind !== "review") {
    throw new IssueError("validation", `"${parsed.issue.id}" is not a review`);
  }
  return parsed.issue;
}

function reviewShell(projectId: string, issues: Issue[], now: string, archived: boolean) {
  return {
    kind: "review" as const,
    partOf: projectId,
    archived,
    marks: { all: {}, commits: {} },
    submissions: [],
    order: nextSiblingOrder(issues, "review", projectId, undefined),
    createdAt: now,
    updatedAt: now,
  };
}

/** A new, unwritten review of a Story, with an id none of `takenIds` uses. */
export function buildReviewIssue(
  story: Story,
  projectId: string,
  issues: Issue[],
  takenIds: Iterable<string>,
  { archived, now, pr }: { archived: boolean; now: string; pr?: ReviewPrSource },
): ReviewIssue {
  return parsedReview({
    id: uniqueSlug(`${story.id}-review`, takenIds),
    title: story.title,
    story: story.id,
    ...(pr ? { pr } : {}),
    ...reviewShell(projectId, issues, now, archived),
  });
}

/** `owner/repo#N`, case-folded, so two spellings of one pull request URL compare equal. */
export function pullRequestKey(url: string): string | undefined {
  try {
    const parsed = parsePrUrl(url);
    return `${parsed.owner.toLowerCase()}/${parsed.repo.toLowerCase()}#${parsed.number}`;
  } catch {
    return undefined;
  }
}

/** The Story in this Project whose `prUrl` is this pull request. */
export function storyForPullRequest(
  projectId: string,
  pr: Pick<ReviewPrSource, "url">,
  issues: Issue[],
): Story | undefined {
  const key = pullRequestKey(pr.url);
  if (!key) return undefined;
  const inProject = subtreeIds(issues, projectId);
  return issues.find((issue): issue is Story => {
    if (issue.kind !== "story" || !issue.prUrl || !inProject.has(issue.id)) return false;
    return pullRequestKey(issue.prUrl) === key;
  });
}

function reviewCoversPullRequest(
  review: ReviewIssue,
  pr: ReviewPrSource,
  storyId: string | undefined,
): boolean {
  if (storyId && review.story === storyId) return true;
  const key = pullRequestKey(pr.url);
  return key !== undefined && review.pr !== undefined && pullRequestKey(review.pr.url) === key;
}

function openReviewCovering(
  projectId: string,
  pr: ReviewPrSource,
  storyId: string | undefined,
  issues: readonly Issue[],
): ReviewIssue | undefined {
  return issues.find(
    (issue): issue is ReviewIssue =>
      issue.kind === "review" &&
      issue.partOf === projectId &&
      !issue.archived &&
      reviewCoversPullRequest(issue, pr, storyId),
  );
}

function commitNewReview(
  review: ReviewIssue,
  issues: Issue[],
): { created: true; review: ReviewRecordView } {
  const graph = [...issues, review];
  const problems = problemsFor(review.id, graph);
  if (problems.length > 0) {
    throw new IssueError("validation", problems.map((p) => p.message).join("; "));
  }
  commitIssueBatch([{ issue: review }], []);
  return { created: true, review: toView(review, graph) };
}

function commitCreatedReview(
  review: ReviewIssue,
  issues: Issue[],
): { created: true; review: ReviewRecordView } {
  assertGuestAllowsOutwardEffect(GUEST_REFUSED_REVIEW_WORKTREE_CREATE);
  return commitNewReview(review, issues);
}

async function checkoutCreatedReview<T extends { created: boolean; review: ReviewRecordView }>(
  result: T,
): Promise<T> {
  if (!result.created) return result;
  await ensureReviewWorktree(result.review.id);
  return {
    ...result,
    review: readReviewView(result.review.partOf, result.review.id),
  };
}

function attachPrSource(
  review: ReviewIssue,
  pr: ReviewPrSource | undefined,
  issues: Issue[],
): { created: false; review: ReviewRecordView } {
  if (!pr || review.pr) return { created: false, review: toView(review, issues) };
  const next: ReviewIssue = { ...review, pr, updatedAt: new Date().toISOString() };
  const issue = parsedReview(next);
  commitIssueBatch([{ issue }], []);
  const graph = issues.map((item) => (item.id === issue.id ? issue : item));
  return { created: false, review: toView(issue, graph) };
}

function buildPullRequestReview(
  resolved: ResolvedReviewPr,
  projectId: string,
  issues: Issue[],
  now: string,
): ReviewIssue {
  return parsedReview({
    id: uniqueSlug(`pr-${resolved.pr.number}-review`, issues.map((issue) => issue.id)),
    title: resolved.title,
    pr: resolved.pr,
    ...reviewShell(projectId, issues, now, false),
  });
}

function startReview(
  projectId: string,
  storyId: string,
  pr?: ReviewPrSource,
): Promise<{ created: boolean; review: ReviewRecordView }> {
  return serialize(() => {
    ensureMigrations();
    const { issues } = readAll();
    const story = requireStoryInProject(projectId, storyId, issues);
    // A review stays the story's review after its task commits are gone.
    const existing = reviewOfStory(projectId, storyId, issues);
    if (existing) return attachPrSource(existing, pr, issues);
    assertStoryHasTaskCommits(storyId);
    const review = buildReviewIssue(
      story,
      projectId,
      issues,
      issues.map((issue) => issue.id),
      { archived: false, now: new Date().toISOString(), pr },
    );
    return commitCreatedReview(review, issues);
  }).then(checkoutCreatedReview);
}

function openResolvedPullRequest(
  projectId: string,
  resolved: ResolvedReviewPr,
): Promise<{ created: boolean; review: ReviewRecordView }> {
  return serialize(() => {
    ensureMigrations();
    const { issues } = readAll();
    const story = storyForPullRequest(projectId, resolved.pr, issues);
    const open = openReviewCovering(projectId, resolved.pr, story?.id, issues);
    if (open) return attachPrSource(open, resolved.pr, issues);
    if (story) {
      const existing = storedReviewForStory(story.id, issues);
      if (existing && existing.partOf === projectId) {
        return attachPrSource(existing, resolved.pr, issues);
      }
      const review = buildReviewIssue(
        story,
        projectId,
        issues,
        issues.map((issue) => issue.id),
        { archived: false, now: new Date().toISOString(), pr: resolved.pr },
      );
      return commitCreatedReview(review, issues);
    }
    return commitCreatedReview(
      buildPullRequestReview(resolved, projectId, issues, new Date().toISOString()),
      issues,
    );
  }).then(checkoutCreatedReview);
}

async function openReviewForStory(
  projectId: string,
  storyId: string,
): Promise<{ created: boolean; review: ReviewRecordView }> {
  const story = requireStoryInProject(projectId, storyId);
  const pr = story.prUrl ? (await resolveReviewPr(projectId, story.prUrl)).pr : undefined;
  return startReview(projectId, storyId, pr);
}

/** Start a review of a Story in this Project, or return the one it already has. */
export async function openOrCreateReview(
  projectId: string,
  body: unknown,
): Promise<{ created: boolean; review: ReviewRecordView; source: "pr" | "story" }> {
  const parsed = parseOpenReviewBody(body);
  if (!parsed.ok) throw new IssueError("validation", parsed.message);
  const id = requireProject(projectId);
  if ("pr" in parsed.body) {
    const opened = await openResolvedPullRequest(id, await resolveReviewPr(id, parsed.body.pr));
    return { ...opened, source: "pr" };
  }
  const opened = await openReviewForStory(id, parsed.body.story);
  return { ...opened, source: "story" };
}

/** Start a review of a Story, or return the one it already has. */
export function startStoryReview(
  storyId: string,
): Promise<{ created: boolean; review: ReviewRecordView }> {
  const projectId = ancestorChain(storyId, readAll().issues)[0]!.id;
  return openReviewForStory(projectId, storyId);
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

export async function archiveReview(
  projectId: string,
  reviewId: string,
): Promise<ReviewRecordView> {
  await setReviewArchived(projectId, reviewId, true);
  await attemptReviewWorktreeRemoval(reviewId);
  return readReviewView(projectId, reviewId);
}

export async function reopenReview(
  projectId: string,
  reviewId: string,
): Promise<ReviewRecordView> {
  await setReviewArchived(projectId, reviewId, false);
  await ensureReviewWorktree(reviewId);
  return readReviewView(projectId, reviewId);
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
