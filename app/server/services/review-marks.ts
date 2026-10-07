import type { Issue } from "../schemas.js";
import { IssueError } from "./errors.js";
import { readAll } from "./issues.js";
import {
  parseSetReviewMarkBody,
  type Review,
  type ReviewProgress,
  type ReviewRecordView,
  type ReviewView,
  type SetReviewMarkBody,
} from "../schemas/review.js";
import {
  loadReviewChangeSpan,
  readDiffBlobs,
  refuseForeignSha,
  type DiffBlob,
} from "./review-diff.js";
import { assertStoreWritable } from "./store-read-only.js";
import { readReviewView, updateStoredReview } from "./reviews.js";

type ReviewMarkIndex = {
  all: DiffBlob[];
  commits: Record<string, DiffBlob[]>;
};

async function readReviewMarkIndex(
  projectId: string,
  storyId: string,
  issues?: Issue[],
): Promise<ReviewMarkIndex> {
  const span = await loadReviewChangeSpan(projectId, storyId, issues);
  if (span.state === "empty") return { all: [], commits: {} };
  const [all, pairs] = await Promise.all([
    readDiffBlobs(span.workspace, span.allRange),
    Promise.all(
      span.commits.map(async (commit) => {
        const files = await readDiffBlobs(span.workspace, commit.range);
        return [commit.sha, files] as const;
      }),
    ),
  ]);
  return { all, commits: Object.fromEntries(pairs) };
}

function scopeFiles(index: ReviewMarkIndex, scope: string): DiffBlob[] {
  if (scope === "all") return index.all;
  const files = index.commits[scope];
  if (!files) refuseForeignSha(scope);
  return files;
}

function requireFile(files: DiffBlob[], path: string): DiffBlob {
  const file = files.find((entry) => entry.path === path);
  if (!file) {
    throw new IssueError("validation", `path "${path}" is not in this diff`);
  }
  return file;
}

function applyMark(
  review: Review,
  body: SetReviewMarkBody,
  blobSha: string,
): Review {
  const now = new Date().toISOString();
  const { scope, path, reviewed } = body;
  if (scope === "all") {
    if (reviewed) {
      return {
        ...review,
        updatedAt: now,
        marks: {
          all: { ...review.marks.all, [path]: { blobSha, markedAt: now } },
          commits: review.marks.commits,
        },
      };
    }
    if (!(path in review.marks.all)) return review;
    const all = { ...review.marks.all };
    delete all[path];
    return { ...review, updatedAt: now, marks: { all, commits: review.marks.commits } };
  }

  const existing = review.marks.commits[scope];
  if (reviewed) {
    return {
      ...review,
      updatedAt: now,
      marks: {
        all: review.marks.all,
        commits: {
          ...review.marks.commits,
          [scope]: { ...existing, [path]: { markedAt: now } },
        },
      },
    };
  }
  if (!existing?.[path]) return review;
  const bucket = { ...existing };
  delete bucket[path];
  const commits = { ...review.marks.commits };
  if (Object.keys(bucket).length === 0) delete commits[scope];
  else commits[scope] = bucket;
  return { ...review, updatedAt: now, marks: { all: review.marks.all, commits } };
}

function reviewProgress(review: Review, index: ReviewMarkIndex): ReviewProgress {
  const changedSinceReviewed: string[] = [];
  let reviewed = 0;
  for (const file of index.all) {
    const mark = review.marks.all[file.path];
    if (!mark) continue;
    if (mark.blobSha === file.blobSha) reviewed += 1;
    else changedSinceReviewed.push(file.path);
  }
  const commits: ReviewProgress["commits"] = {};
  for (const [sha, files] of Object.entries(index.commits)) {
    const bucket = review.marks.commits[sha] ?? {};
    let count = 0;
    for (const file of files) {
      if (bucket[file.path]) count += 1;
    }
    commits[sha] = { reviewed: count, total: files.length };
  }
  return {
    all: { reviewed, total: index.all.length, changedSinceReviewed },
    commits,
  };
}

function attachProgress(view: ReviewRecordView, index: ReviewMarkIndex): ReviewView {
  return { ...view, progress: reviewProgress(view, index) };
}

export async function readReviewProgress(
  projectId: string,
  view: ReviewRecordView,
  issues?: Issue[],
): Promise<ReviewProgress> {
  const index = await readReviewMarkIndex(projectId, view.target.storyId, issues);
  return reviewProgress(view, index);
}

export async function withReviewProgress(
  projectId: string,
  view: ReviewRecordView,
  issues?: Issue[],
): Promise<ReviewView> {
  const index = await readReviewMarkIndex(projectId, view.target.storyId, issues);
  return attachProgress(view, index);
}

function archivedError(reviewId: string): IssueError {
  return new IssueError("validation", `review "${reviewId}" is archived`);
}

export async function setReviewMark(
  projectId: string,
  reviewId: string,
  body: unknown,
): Promise<ReviewView> {
  const parsed = parseSetReviewMarkBody(body);
  if (!parsed.ok) throw new IssueError("validation", parsed.message);
  assertStoreWritable();

  const issues = readAll().issues;
  const current = readReviewView(projectId, reviewId, issues);
  if (current.effectiveStatus === "archived") throw archivedError(reviewId);

  const index = await readReviewMarkIndex(projectId, current.target.storyId, issues);
  const file = requireFile(scopeFiles(index, parsed.body.scope), parsed.body.path);

  const view = updateStoredReview(
    projectId,
    reviewId,
    (review, stored) => {
      if (stored.effectiveStatus === "archived") throw archivedError(reviewId);
      return applyMark(review, parsed.body, file.blobSha);
    },
    issues,
  );
  return attachProgress(view, index);
}
