import { z } from "zod";
import { formatZodError, type Issue } from "./issue.js";
import type { ReviewSubmission } from "./review-state.js";

export {
  reviewMarksSchema,
  reviewSubmissionSchema,
  type ReviewMarks,
  type ReviewPrSource,
  type ReviewSubmission,
} from "./review-state.js";

const nonEmpty = z.string().min(1);

export type ReviewIssue = Extract<Issue, { kind: "review" }>;

/** Derived on read for every submission that is not `done`. */
export type ReviewSubmissionOpen = {
  round: number;
  openThreadIds: string[];
};

export type ReviewSubmissionView =
  | Extract<ReviewSubmission, { status: "done" }>
  | (Exclude<ReviewSubmission, { status: "done" }> & ReviewSubmissionOpen);

export type ReviewScopeProgress = {
  reviewed: number;
  total: number;
};

export type ReviewProgress = {
  all: ReviewScopeProgress & { changedSinceReviewed: string[] };
  commits: Record<string, ReviewScopeProgress>;
};

/** `archivedReason` is `merged` when the archived review's Story is merged. */
export type ReviewLifecycle =
  | { status: "open" }
  | { status: "archived"; archivedReason: "explicit" | "merged" };

/** A review issue plus its status, before derived progress is attached. */
export type ReviewRecordView = Omit<ReviewIssue, "submissions"> &
  ReviewLifecycle & { submissions: ReviewSubmissionView[] };

/**
 * The checkout is behind the reviewed tip and a runtime or researcher still
 * has the worktree. `ref` is the Story branch, the pull request head, or the
 * Story id when that Story has no branch name.
 */
export type ReviewWorktreeSyncHold = {
  newCommits: number;
  ref: string;
};

export type ReviewView = ReviewRecordView & {
  progress: ReviewProgress;
  worktreeSync?: ReviewWorktreeSyncHold;
};

/** A Story with at least one Task commit, offered when starting a review. */
export type ReviewCandidate = {
  storyId: string;
  title: string;
  merged: boolean;
  reviewId?: string;
  lastCommitAt: string;
};

export type ReviewCandidates = {
  stories: ReviewCandidate[];
};

/** `GET/POST/DELETE /api/reviews/:id/runtime`. */
export type ReviewRuntimeStatus = {
  state: "stopped" | "booting" | "running" | "failed";
  baseUrl?: string;
  error?: string;
};

export const openReviewBodySchema = z.union([
  z.object({ story: nonEmpty }).strict(),
  z.object({ pr: nonEmpty }).strict(),
]);

export type OpenReviewBody = z.infer<typeof openReviewBodySchema>;

export const submitReviewBodySchema = z
  .object({
    summary: z.string().optional(),
  })
  .strict();

export type SubmitReviewBody = z.infer<typeof submitReviewBodySchema>;

export type SubmitReviewBodyParseResult =
  | { ok: true; body: SubmitReviewBody }
  | { ok: false; message: string };

export function parseSubmitReviewBody(raw: unknown): SubmitReviewBodyParseResult {
  const result = submitReviewBodySchema.safeParse(raw ?? {});
  if (result.success) return { ok: true, body: result.data };
  return {
    ok: false,
    message: formatZodError(result.error, "invalid submission body"),
  };
}

export const retryReviewSubmissionBodySchema = z.object({}).strict();

export type RetryReviewSubmissionBodyParseResult =
  | { ok: true }
  | { ok: false; message: string };

export function parseRetryReviewSubmissionBody(
  raw: unknown,
): RetryReviewSubmissionBodyParseResult {
  const result = retryReviewSubmissionBodySchema.safeParse(raw ?? {});
  if (result.success) return { ok: true };
  return { ok: false, message: "retry body must be empty" };
}

export type OpenReviewBodyParseResult =
  | { ok: true; body: OpenReviewBody }
  | { ok: false; message: string };

export function parseOpenReviewBody(raw: unknown): OpenReviewBodyParseResult {
  const result = openReviewBodySchema.safeParse(raw);
  if (result.success) return { ok: true, body: result.data };
  return {
    ok: false,
    message: formatZodError(result.error, "invalid review body"),
  };
}

export const setReviewMarkBodySchema = z
  .object({
    scope: nonEmpty,
    path: nonEmpty,
    reviewed: z.boolean(),
  })
  .strict();

export type SetReviewMarkBody = z.infer<typeof setReviewMarkBodySchema>;

export type SetReviewMarkBodyParseResult =
  | { ok: true; body: SetReviewMarkBody }
  | { ok: false; message: string };

export function parseSetReviewMarkBody(raw: unknown): SetReviewMarkBodyParseResult {
  const result = setReviewMarkBodySchema.safeParse(raw);
  if (result.success) return { ok: true, body: result.data };
  return {
    ok: false,
    message: formatZodError(result.error, "invalid review mark"),
  };
}

export type ReviewDiffStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "typechange";

export type ReviewCommitSummary = {
  sha: string;
  subject: string;
  author: string;
  authoredAt: string;
  files: number;
  additions: number;
  deletions: number;
};

export type ReviewCommits = {
  mergeBase: string;
  mergeBaseRef: string;
  tip: string;
  commits: ReviewCommitSummary[];
};

export type ReviewDiffFile = {
  path: string;
  oldPath?: string;
  status: ReviewDiffStatus;
  additions: number;
  deletions: number;
  blobSha: string;
  tooLarge: boolean;
};

export type ReviewDiff = {
  scope: string;
  files: ReviewDiffFile[];
  patch: string;
};
