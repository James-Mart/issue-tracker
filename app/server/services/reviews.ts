import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "fs";
import { basename, join } from "path";
import { issuesDir } from "../config.js";
import type { Issue } from "../schemas/issue.js";
import {
  parseOpenReviewBody,
  parseReviewRecord,
  type Review,
  type ReviewView,
} from "../schemas/review.js";
import { collectDescendantCommits } from "./change.js";
import { IssueError } from "./errors.js";
import { readAll, readIssueOrThrow } from "./issues.js";
import { replaceFileAtomically, withIssuesStoreLock } from "./issues-store-lock.js";
import { requireProject } from "./require-project.js";
import { assertStoreWritable } from "./store-read-only.js";
import { ancestorChain } from "./subtree.js";

type Story = Extract<Issue, { kind: "story" }>;

function reviewsDir(projectId: string): string {
  return join(issuesDir, projectId, "reviews");
}

/** Refuse a review id that is not one safe path segment under the project reviews directory. */
function reviewFilePath(projectId: string, reviewId: string): string {
  if (
    !reviewId ||
    reviewId.includes("\0") ||
    reviewId.includes("/") ||
    reviewId.includes("\\") ||
    reviewId === "." ||
    reviewId === ".." ||
    basename(reviewId) !== reviewId
  ) {
    throw new IssueError("not_found", `unknown review "${reviewId}"`);
  }
  return join(reviewsDir(projectId), `${reviewId}.json`);
}

export function requireStoryInProject(projectId: string, storyId: string): Story {
  const story = readIssueOrThrow(storyId);
  if (story.kind !== "story") {
    throw new IssueError(
      "validation",
      `target "${storyId}" is not a story`,
    );
  }
  const { issues } = readAll();
  const project = ancestorChain(storyId, issues)[0]!;
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

function readStoredReview(projectId: string, reviewId: string): Review {
  const path = reviewFilePath(projectId, reviewId);
  if (!existsSync(path)) {
    throw new IssueError("not_found", `unknown review "${reviewId}"`);
  }
  const text = readFileSync(path, "utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new IssueError("validation", `invalid review JSON: ${detail}`);
  }
  const parsed = parseReviewRecord(raw);
  if (!parsed.ok) {
    throw new IssueError("validation", parsed.message);
  }
  if (parsed.review.id !== reviewId) {
    throw new IssueError(
      "validation",
      `review id "${parsed.review.id}" does not match file name`,
    );
  }
  if (parsed.review.projectId !== projectId) {
    throw new IssueError(
      "validation",
      `review "${reviewId}" belongs to project "${parsed.review.projectId}"`,
    );
  }
  return parsed.review;
}

function listStoredReviews(projectId: string): Review[] {
  const dir = reviewsDir(projectId);
  if (!existsSync(dir)) return [];
  const reviews = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readStoredReview(projectId, basename(name, ".json")));
  const seen = new Map<string, string>();
  for (const review of reviews) {
    const storyId = review.target.storyId;
    const previous = seen.get(storyId);
    if (previous) {
      throw new IssueError(
        "validation",
        `multiple reviews for story "${storyId}"`,
      );
    }
    seen.set(storyId, review.id);
  }
  reviews.sort((a, b) => {
    const byTime = a.createdAt.localeCompare(b.createdAt);
    return byTime === 0 ? a.id.localeCompare(b.id) : byTime;
  });
  return reviews;
}

function findReviewForStory(
  projectId: string,
  storyId: string,
): Review | undefined {
  return listStoredReviews(projectId).find(
    (review) => review.target.storyId === storyId,
  );
}

function storyForReview(review: Review, byId?: Map<string, Issue>): Story {
  const cached = byId?.get(review.target.storyId);
  if (cached?.kind === "story") return cached;
  if (cached) {
    throw new IssueError(
      "validation",
      `review target "${review.target.storyId}" is not a story`,
    );
  }
  const story = readIssueOrThrow(review.target.storyId);
  if (story.kind !== "story") {
    throw new IssueError(
      "validation",
      `review target "${review.target.storyId}" is not a story`,
    );
  }
  return story;
}

/**
 * Effective archive is computed on read. Stored `status: "archived"` is an
 * explicit archive. A merged Story archives a review that is not a post-mortem.
 */
function toView(review: Review, story: Story): ReviewView {
  if (review.status === "archived") {
    return { ...review, effectiveStatus: "archived", archivedReason: "explicit" };
  }
  if (story.merged && !review.postMortem) {
    return { ...review, effectiveStatus: "archived", archivedReason: "merged" };
  }
  return { ...review, effectiveStatus: "open" };
}

function writeReview(review: Review): void {
  const dir = reviewsDir(review.projectId);
  mkdirSync(dir, { recursive: true });
  replaceFileAtomically(
    reviewFilePath(review.projectId, review.id),
    `${JSON.stringify(review, null, 2)}\n`,
  );
}

function withReviewWrite<T>(projectId: string, fn: (projectId: string) => T): T {
  assertStoreWritable();
  return withIssuesStoreLock(() => fn(requireProject(projectId)));
}

export function listReviewViews(
  projectId: string,
  storyId?: string,
): { reviews: ReviewView[] } {
  const id = requireProject(projectId);
  const reviews = listStoredReviews(id);
  const matched =
    storyId === undefined
      ? reviews
      : reviews.filter((review) => review.target.storyId === storyId);
  const byId = new Map(readAll().issues.map((issue) => [issue.id, issue]));
  return {
    reviews: matched.map((review) => toView(review, storyForReview(review, byId))),
  };
}

export function readReviewView(projectId: string, reviewId: string): ReviewView {
  const id = requireProject(projectId);
  const review = readStoredReview(id, reviewId);
  return toView(review, storyForReview(review));
}

export function openOrCreateReview(
  projectId: string,
  body: unknown,
): { created: boolean; review: ReviewView } {
  const parsed = parseOpenReviewBody(body);
  if (!parsed.ok) throw new IssueError("validation", parsed.message);
  const storyId = parsed.body.target.storyId;
  return withReviewWrite(projectId, (id) => {
    const story = requireStoryInProject(id, storyId);
    const existing = findReviewForStory(id, storyId);
    // A stored review stays the story's review after its task commits are gone.
    if (existing) return { created: false, review: toView(existing, story) };
    assertStoryHasTaskCommits(storyId);
    const now = new Date().toISOString();
    const review: Review = {
      id: randomUUID(),
      projectId: id,
      target: { kind: "story", storyId },
      status: "open",
      postMortem: story.merged,
      createdAt: now,
      updatedAt: now,
      marks: { all: {}, commits: {} },
    };
    writeReview(review);
    return { created: true, review: toView(review, story) };
  });
}

export function archiveReview(projectId: string, reviewId: string): ReviewView {
  return withReviewWrite(projectId, (id) => {
    const review = readStoredReview(id, reviewId);
    const story = storyForReview(review);
    if (review.status === "archived") return toView(review, story);
    const next: Review = {
      ...review,
      status: "archived",
      updatedAt: new Date().toISOString(),
    };
    writeReview(next);
    return toView(next, story);
  });
}

export function reopenReview(projectId: string, reviewId: string): ReviewView {
  return withReviewWrite(projectId, (id) => {
    const review = readStoredReview(id, reviewId);
    const story = requireStoryInProject(id, review.target.storyId);
    const postMortem = review.postMortem || story.merged;
    if (review.status === "open" && review.postMortem === postMortem) {
      return toView(review, story);
    }
    const next: Review = {
      ...review,
      status: "open",
      postMortem,
      updatedAt: new Date().toISOString(),
    };
    writeReview(next);
    return toView(next, story);
  });
}
