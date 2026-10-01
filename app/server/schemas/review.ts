import { z } from "zod";
import { formatZodError } from "./issue.js";

const nonEmpty = z.string().min(1);

const allMarkSchema = z
  .object({
    // Empty when the post-image has no blob (a deletion).
    blobSha: z.string(),
    markedAt: nonEmpty,
  })
  .strict();

const commitMarkSchema = z
  .object({
    markedAt: nonEmpty,
  })
  .strict();

export const reviewTargetSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("story"),
      storyId: nonEmpty,
    })
    .strict(),
]);

const reviewSubmissionIdentity = {
  id: nonEmpty,
  at: nonEmpty,
  summaryCommentId: nonEmpty.optional(),
  threadIds: z.array(nonEmpty).min(1),
};

export const reviewSubmissionSchema = z.discriminatedUnion("status", [
  z
    .object({
      ...reviewSubmissionIdentity,
      // Filled once the background launch has created the tasker conversation.
      conversationId: nonEmpty.optional(),
      status: z.literal("tasking"),
      taskIds: z.array(nonEmpty).optional(),
    })
    .strict(),
  z
    .object({
      ...reviewSubmissionIdentity,
      conversationId: nonEmpty.optional(),
      status: z.literal("incomplete"),
      taskIds: z.array(nonEmpty).optional(),
    })
    .strict(),
  z
    .object({
      ...reviewSubmissionIdentity,
      conversationId: nonEmpty.optional(),
      status: z.literal("failed"),
      taskIds: z.array(nonEmpty).optional(),
      error: nonEmpty,
    })
    .strict(),
  z
    .object({
      ...reviewSubmissionIdentity,
      conversationId: nonEmpty.optional(),
      status: z.literal("done"),
      taskIds: z.array(nonEmpty),
    })
    .strict(),
]);

export type ReviewSubmission = z.infer<typeof reviewSubmissionSchema>;

/** Derived on read for every submission that is not `done`. */
export type ReviewSubmissionOpen = {
  round: number;
  openThreadIds: string[];
};

export type ReviewSubmissionView =
  | Extract<ReviewSubmission, { status: "done" }>
  | (Exclude<ReviewSubmission, { status: "done" }> & ReviewSubmissionOpen);

export const reviewSchema = z
  .object({
    id: nonEmpty,
    projectId: nonEmpty,
    target: reviewTargetSchema,
    status: z.enum(["open", "archived"]),
    postMortem: z.boolean(),
    createdAt: nonEmpty,
    updatedAt: nonEmpty,
    marks: z
      .object({
        all: z.record(z.string(), allMarkSchema),
        commits: z.record(
          z.string(),
          z.record(z.string(), commitMarkSchema),
        ),
      })
      .strict(),
    submissions: z.array(reviewSubmissionSchema).default([]),
  })
  .strict();

export type Review = z.infer<typeof reviewSchema>;

export type ReviewScopeProgress = {
  reviewed: number;
  total: number;
};

export type ReviewProgress = {
  all: ReviewScopeProgress & { changedSinceReviewed: string[] };
  commits: Record<string, ReviewScopeProgress>;
};

type ReviewEffective =
  | { effectiveStatus: "open" }
  | { effectiveStatus: "archived"; archivedReason: "explicit" | "merged" };

/** Stored review plus effective archive, before derived progress is attached. */
export type ReviewRecordView = Omit<Review, "submissions"> &
  ReviewEffective & { submissions: ReviewSubmissionView[] };

export type ReviewView = ReviewRecordView & { progress: ReviewProgress };

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

export const openReviewBodySchema = z
  .object({
    target: reviewTargetSchema,
  })
  .strict();

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

export type ReviewParseResult =
  | { ok: true; review: Review }
  | { ok: false; message: string };

export function parseReviewRecord(raw: unknown): ReviewParseResult {
  const result = reviewSchema.safeParse(raw);
  if (result.success) return { ok: true, review: result.data };
  return {
    ok: false,
    message: formatZodError(result.error, "invalid review"),
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
