import { z } from "zod";
import { formatZodError, type Issue } from "./issue.js";
import type { ReviewSubmission } from "./review-state.js";

export {
  reviewMarksSchema,
  reviewSubmissionSchema,
  standardsAssessmentSchema,
  type ReviewMarks,
  type ReviewPrSource,
  type ReviewSubmission,
  type StandardsAssessment,
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

/** Lifecycle of one top-level review conversation on the Agents tab. */
export const reviewAgentRunStatusSchema = z.enum([
  "running",
  "completed",
  "error",
  "unknown",
]);

export type ReviewAgentRunStatus = z.infer<typeof reviewAgentRunStatusSchema>;

/**
 * One top-level review run. Nested delegates stay in that conversation's
 * transcript and are not records. `submittedEntry` is tasker-only.
 */
export const reviewAgentRunSchema = z
  .object({
    conversationId: nonEmpty,
    role: nonEmpty,
    model: nonEmpty,
    status: reviewAgentRunStatusSchema,
    startedAt: nonEmpty,
    endedAt: nonEmpty.optional(),
    questionExcerpt: nonEmpty.optional(),
    threadId: nonEmpty.optional(),
    round: z.number().int().positive().optional(),
    submittedAt: nonEmpty.optional(),
    submissionId: nonEmpty.optional(),
    submittedEntry: z.boolean().optional(),
  })
  .strict();

export type ReviewAgentRun = z.infer<typeof reviewAgentRunSchema>;

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

export type RuntimeBootPhase = "build" | "start" | "seed" | "readiness";

/** `GET/POST/DELETE /api/reviews/:id/runtime`. */
export type ReviewRuntimeStatus = {
  state: "stopped" | "booting" | "running" | "failed";
  baseUrl?: string;
  error?: string;
  phase?: RuntimeBootPhase;
  phaseStartedAt?: string;
  failedPhase?: RuntimeBootPhase;
};

/** `GET /api/reviews/:id/runtime/log`. */
export type ReviewRuntimeLog = {
  phase: RuntimeBootPhase;
  log: string;
  lines: string[];
};

export const openReviewBodySchema = z.union([
  z.object({ story: nonEmpty }).strict(),
  z.object({ pr: nonEmpty }).strict(),
]);

export type OpenReviewBody = z.infer<typeof openReviewBodySchema>;

/** `story` appends Tasks to the source Story; `idea` queues a new Idea for auto-plan. */
export const REVIEW_SUBMIT_DESTINATIONS = ["story", "idea"] as const;

export type ReviewSubmitDestination = (typeof REVIEW_SUBMIT_DESTINATIONS)[number];

export const submitReviewBodySchema = z
  .object({
    destination: z.enum(REVIEW_SUBMIT_DESTINATIONS),
    summary: z.string().optional(),
    assessStandards: z.boolean().optional(),
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

export const emptyBodySchema = z.object({}).strict();

export type EmptyBodyParseResult = { ok: true } | { ok: false; message: string };

export function parseEmptyBody(raw: unknown, message: string): EmptyBodyParseResult {
  const result = emptyBodySchema.safeParse(raw ?? {});
  if (result.success) return { ok: true };
  return { ok: false, message };
}

export function parseRetryReviewSubmissionBody(raw: unknown): EmptyBodyParseResult {
  return parseEmptyBody(raw, "retry body must be empty");
}

/** `null` clears the field; an absent key leaves it as stored. */
export const setStandardsProposalBodySchema = z
  .object({
    decision: z.enum(["accepted", "rejected", "iterate"]).nullable().optional(),
    editedAfter: nonEmpty.nullable().optional(),
    feedback: nonEmpty.nullable().optional(),
  })
  .strict()
  .refine(
    (body) =>
      body.decision !== undefined ||
      body.editedAfter !== undefined ||
      body.feedback !== undefined,
    { message: "set decision, editedAfter, or feedback" },
  );

export type SetStandardsProposalBody = z.infer<typeof setStandardsProposalBodySchema>;

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
