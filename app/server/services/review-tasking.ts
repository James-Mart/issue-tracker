import { randomUUID } from "crypto";
import type { AgentRun, ConversationMeta, Issue } from "../schemas.js";
import type {
  ReviewRecordView,
  ReviewSubmission,
  ReviewSubmissionView,
  StandardsAssessment,
} from "../schemas/review.js";
import { parseRetryReviewSubmissionBody } from "../schemas/review.js";
import type { AgentRunStatus } from "./agent-sdk.js";
import type { AgentSessions } from "./agent-sessions.js";
import { resumeCoordinator } from "./bring-in-coordinator.js";
import type { ConversationMessageSessions } from "./conversation-message.js";
import {
  createConversation,
  deleteConversation,
  listConversations,
  readConversationMeta,
  startConversationPrompt,
} from "./conversations.js";
import { IssueError } from "./errors.js";
import {
  appendComment,
  readAll,
  readComments,
  readIssueOrThrow,
  readReviewOrThrow,
} from "./issues.js";
import { submittableRootIds } from "../../src/features/reviews/lib/review-submittable.js";
import { isRetryableSubmission } from "../review-submission-status.js";
import { ancestorChain, nearestImplementingWorkRootId } from "./subtree.js";
import {
  presentSubmissions,
  splitSubmissionThreads,
  submissionThreads,
} from "./review-submission-threads.js";
import { requireProjectWorkspace } from "./project-workspace.js";
import { requireProject } from "./require-project.js";
import { isRunLive } from "./run-live.js";
import { readReviewView, requireReviewStory, updateStoredReview } from "./reviews.js";
import { loadRoleBody, loadRoleModelPin } from "./role-bodies.js";

export const REVIEW_TASKER_ROLE = "issue-tracker-review-tasker";

export const NO_READY_THREADS_ERROR = "no threads are ready to task";

export const SUBMISSION_TASKING_ERROR = "a submission is already tasking";

export const NO_RETRYABLE_SUBMISSION_ERROR = "no submission to retry";

const REVIEW_TASKER_DELEGATION_PREFIX = "review-tasker:";

export function mergedStoryTaskingError(storyId: string): string {
  return `story "${storyId}" is merged — Tasks can't be appended`;
}

export function reviewTaskerDelegationId(conversationId: string): string {
  return `${REVIEW_TASKER_DELEGATION_PREFIX}${conversationId}`;
}

export function conversationIdFromReviewTaskerDelegation(
  delegationId: string,
): string | undefined {
  if (!delegationId.startsWith(REVIEW_TASKER_DELEGATION_PREFIX)) return undefined;
  const conversationId = delegationId.slice(REVIEW_TASKER_DELEGATION_PREFIX.length);
  return conversationId.length > 0 ? conversationId : undefined;
}

export type TaskingRunOutcome = {
  status: AgentRunStatus;
  errorMessage?: string;
};

function submittableThreadIds(
  reviewId: string,
  submissions: readonly ReviewSubmission[],
): string[] {
  return submittableRootIds(readComments(reviewId).threads, submissions);
}

/** Re-read under the store lock. Another submission can land after the first read. */
export function assertThreadsStillSubmittable(
  reviewId: string,
  submissions: readonly ReviewSubmission[],
  threadIds: readonly string[],
): void {
  const readyNow = new Set(submittableThreadIds(reviewId, submissions));
  if (threadIds.some((id) => !readyNow.has(id))) {
    throw new IssueError(
      "conflict",
      "ready threads changed before the submission was recorded",
    );
  }
}

function taskingPrompt(review: ReviewRecordView, threadIds: string[]): string {
  return [
    loadRoleBody(REVIEW_TASKER_ROLE),
    "",
    `Review: ${review.id}`,
    `Story: ${requireReviewStory(review)}`,
    `Threads: ${threadIds.join(", ")}`,
  ].join("\n");
}

function submissionBase(
  submission: ReviewSubmission,
): Omit<ReviewSubmission, "status" | "taskIds" | "error"> {
  return {
    id: submission.id,
    at: submission.at,
    ...(submission.summaryCommentId
      ? { summaryCommentId: submission.summaryCommentId }
      : {}),
    threadIds: submission.threadIds,
    ...(submission.conversationId
      ? { conversationId: submission.conversationId }
      : {}),
    ...(submission.coordinatorResumed ? { coordinatorResumed: true as const } : {}),
    ...(submission.standards ? { standards: submission.standards } : {}),
  };
}

function taskingSubmission(
  submission: ReviewSubmission,
  taskIds: string[] | undefined,
): Extract<ReviewSubmission, { status: "tasking" }> {
  return {
    ...submissionBase(submission),
    status: "tasking",
    ...(taskIds && taskIds.length > 0 ? { taskIds } : {}),
  };
}

function failedSubmission(
  submission: ReviewSubmission,
  error: string,
  taskIds: string[],
): ReviewSubmission {
  return {
    ...submissionBase(submission),
    status: "failed",
    ...(taskIds.length > 0 ? { taskIds } : {}),
    error,
  };
}

function doneSubmission(
  submission: ReviewSubmission,
  taskIds: string[],
): Extract<ReviewSubmission, { status: "done" }> {
  return {
    ...submissionBase(submission),
    status: "done",
    taskIds,
  };
}

function incompleteSubmission(
  submission: ReviewSubmission,
  taskIds: string[],
): Extract<ReviewSubmission, { status: "incomplete" }> {
  return {
    ...submissionBase(submission),
    status: "incomplete",
    ...(taskIds.length > 0 ? { taskIds } : {}),
  };
}

function failureReason(outcome: TaskingRunOutcome): string {
  const message = outcome.errorMessage?.trim();
  if (message) return message;
  return `tasking run ${outcome.status}`;
}

function settledSubmission(
  submission: ReviewSubmission,
  split: { taskIds: string[]; openThreadIds: string[] },
  whenOpen: (taskIds: string[]) => ReviewSubmission,
): ReviewSubmission {
  if (split.openThreadIds.length === 0) return doneSubmission(submission, split.taskIds);
  return whenOpen(split.taskIds);
}

async function completeWhenSettled(
  projectId: string,
  review: ReviewRecordView,
  submission: ReviewSubmission,
  split: { taskIds: string[]; openThreadIds: string[] },
  sessions: ConversationMessageSessions,
): Promise<boolean> {
  const next = settledSubmission(submission, split, () => submission);
  if (next.status !== "done") return false;
  replaceSubmission(projectId, review.id, submission.id, next);
  await bringCoordinatorForDone(projectId, review, next, sessions);
  return true;
}

function assertStoryOpenForTasking(storyId: string) {
  const story = readIssueOrThrow(storyId);
  if (story.kind !== "story") {
    throw new IssueError("validation", `issue "${storyId}" is not a story`);
  }
  if (story.merged) {
    throw new IssueError("validation", mergedStoryTaskingError(storyId));
  }
  return story;
}

export function assertNoTasking(submissions: readonly { status: string }[]): void {
  if (submissions.some((item) => item.status === "tasking")) {
    throw new IssueError("conflict", SUBMISSION_TASKING_ERROR);
  }
}

function replaceSubmission(
  projectId: string,
  reviewId: string,
  submissionId: string,
  next: ReviewSubmission,
): ReviewRecordView {
  return updateStoredReview(projectId, reviewId, (current) => {
    const index = current.submissions.findIndex(
      (item) => item.id === submissionId,
    );
    if (index < 0) {
      throw new IssueError("not_found", `unknown submission "${submissionId}"`);
    }
    const submissions = current.submissions.slice();
    const stored = current.submissions[index]!;
    // A standards launch may attach its conversation between this snapshot
    // and the lock. Tasking never edits standards, so keep the stored copy.
    submissions[index] = stored.standards ? { ...next, standards: stored.standards } : next;
    return {
      ...current,
      updatedAt: new Date().toISOString(),
      submissions,
    };
  });
}

async function markStartFailed(
  projectId: string,
  review: ReviewRecordView,
  submission: ReviewSubmission,
  message: string,
): Promise<void> {
  const split = submissionThreads(review, submission, readAll().issues);
  replaceSubmission(
    projectId,
    review.id,
    submission.id,
    settledSubmission(submission, split, (taskIds) =>
      failedSubmission(submission, message, taskIds),
    ),
  );
}

/** Post the optional summary comment, then the fields every new submission carries. */
export async function newSubmissionFields(
  reviewId: string,
  summary: string | undefined,
  threadIds: string[],
): Promise<Pick<ReviewSubmission, "id" | "at" | "summaryCommentId" | "threadIds">> {
  const summaryComment = summary
    ? await appendComment(reviewId, { role: "human", body: summary })
    : undefined;
  return {
    id: randomUUID(),
    at: new Date().toISOString(),
    ...(summaryComment ? { summaryCommentId: summaryComment.id } : {}),
    threadIds,
  };
}

/** Record a tasking submission of every submittable thread. The route starts the tasker. */
export async function submitReviewAsTasks(
  projectId: string,
  reviewId: string,
  summary: string | undefined,
  standards?: StandardsAssessment,
): Promise<ReviewRecordView> {
  const project = requireProject(projectId);
  const review = readReviewView(project, reviewId);
  const storyId = requireReviewStory(review);
  assertStoryOpenForTasking(storyId);
  assertNoTasking(review.submissions);
  const threadIds = submittableThreadIds(reviewId, review.submissions);
  if (threadIds.length === 0) {
    throw new IssueError("validation", NO_READY_THREADS_ERROR);
  }
  requireProjectWorkspace(project);

  const submission: ReviewSubmission = {
    ...(await newSubmissionFields(reviewId, summary, threadIds)),
    status: "tasking",
    ...(standards ? { standards } : {}),
  };

  updateStoredReview(project, reviewId, (current) => {
    assertStoryOpenForTasking(storyId);
    assertNoTasking(current.submissions);
    assertThreadsStillSubmittable(reviewId, current.submissions, threadIds);
    return {
      ...current,
      updatedAt: submission.at,
      submissions: [...current.submissions, submission],
    };
  });

  return readReviewView(project, reviewId);
}

async function launchTasking(
  projectId: string,
  review: ReviewRecordView,
  submission: ReviewSubmission,
  conversationId: string,
  prompt: string,
  sessions: AgentSessions,
  persistPrompt: boolean,
): Promise<void> {
  try {
    const started = await startConversationPrompt(
      conversationId,
      prompt,
      sessions,
      persistPrompt ? undefined : { persistPrompt: false },
    );
    if (!started.ok) {
      await markStartFailed(projectId, review, submission, started.message);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markStartFailed(projectId, review, submission, message);
  }
}

function submissionNeedsCoordinator(
  submission: ReviewSubmission | undefined,
): submission is Extract<ReviewSubmission, { status: "done" }> {
  return (
    submission !== undefined &&
    submission.status === "done" &&
    submission.taskIds.length > 0 &&
    submission.coordinatorResumed !== true
  );
}

async function bringCoordinatorForDone(
  projectId: string,
  review: Pick<ReviewRecordView, "id" | "story">,
  submission: ReviewSubmission,
  sessions: ConversationMessageSessions,
): Promise<void> {
  if (!submissionNeedsCoordinator(submission)) return;
  const storyId = requireReviewStory(review);
  try {
    const workRootId = nearestImplementingWorkRootId(
      ancestorChain(storyId, readAll().issues),
    );
    if (workRootId === undefined) {
      throw new Error(`story "${storyId}" has no implementing work root`);
    }
    await resumeCoordinator(workRootId, sessions);
  } catch (err) {
    // Tasking already recorded done. A coordinator delivery failure must
    // not roll that back; the error is logged for follow-up.
    console.error(
      `coordinator was not brought in after review ${review.id} on story ${storyId}`,
      err,
    );
    return;
  }
  replaceSubmission(projectId, review.id, submission.id, {
    ...submission,
    coordinatorResumed: true,
  });
}

/**
 * Create the tasker conversation if this submission does not have one, then
 * start the run. Called after the submit or retry response. A failure is
 * stored on the submission.
 */
export async function launchRecordedSubmission(
  projectId: string,
  reviewId: string,
  submissionId: string,
  kind: "start" | "retry",
  sessions: AgentSessions,
): Promise<void> {
  const review = readReviewView(projectId, reviewId);
  const submission = review.submissions.find((item) => item.id === submissionId);
  // A second finish callback, or a launch that already attached a conversation,
  // must not start another tasker.
  if (!submission || submission.status !== "tasking") return;
  if (kind === "start" && submission.conversationId) return;

  try {
    const story = assertStoryOpenForTasking(requireReviewStory(review));
    const linked = submissionThreads(review, submission, readAll().issues);
    if (await completeWhenSettled(projectId, review, submission, linked, sessions)) {
      return;
    }

    const threadIds = linked.openThreadIds;
    const prompt = taskingPrompt(review, threadIds);
    let current: ReviewSubmission = submission;
    const persisted = submission.conversationId !== undefined;
    if (!submission.conversationId) {
      const meta = await createConversation({
        title: `Tasking ${story.title}`,
        projectId,
        model: loadRoleModelPin(REVIEW_TASKER_ROLE),
        issueId: reviewId,
        channel: "review",
        role: REVIEW_TASKER_ROLE,
        message: prompt,
      });
      current = taskingSubmission(
        { ...submission, conversationId: meta.id },
        submission.taskIds,
      );
      try {
        replaceSubmission(projectId, reviewId, submissionId, current);
      } catch (err) {
        await deleteConversation(meta.id);
        throw err;
      }
    }

    const conversationId = current.conversationId;
    if (!conversationId) {
      throw new Error(`submission "${submissionId}" has no tasker conversation`);
    }
    await launchTasking(
      projectId,
      review,
      current,
      conversationId,
      prompt,
      sessions,
      kind === "retry" && persisted,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const latest =
      readReviewView(projectId, reviewId).submissions.find(
        (item) => item.id === submission.id,
      ) ?? submission;
    if (latest.status !== "tasking") {
      // Classified while this launch was still starting. Leave that record.
      return;
    }
    try {
      await markStartFailed(projectId, review, latest, message);
    } catch (markErr) {
      // The submission is already recorded as tasking, and the HTTP response
      // has been sent. A markStartFailed failure must not reject this background
      // launch; log it for follow-up, same as bringCoordinatorForDone.
      console.error(
        `could not record tasking failure for submission ${submission.id}:`,
        markErr,
      );
    }
  }
}

export async function retryReviewSubmission(
  projectId: string,
  reviewId: string,
  submissionId: string,
  body: unknown,
  sessions: AgentSessions,
): Promise<ReviewRecordView> {
  const parsed = parseRetryReviewSubmissionBody(body);
  if (!parsed.ok) throw new IssueError("validation", parsed.message);
  const project = requireProject(projectId);
  const review = readReviewView(project, reviewId);
  const storyId = requireReviewStory(review);
  assertStoryOpenForTasking(storyId);
  assertNoTasking(review.submissions);
  const submission = review.submissions.find((item) => item.id === submissionId);
  if (!submission) {
    throw new IssueError("not_found", `unknown submission "${submissionId}"`);
  }
  if (!isRetryableSubmission(submission)) {
    throw new IssueError(
      "validation",
      `submission "${submissionId}" is ${submission.status}`,
    );
  }
  const split = submissionThreads(review, submission, readAll().issues);
  const next = nextRetrySubmission(submission, split, sessions);
  if (next.status === "done") {
    replaceSubmission(project, reviewId, submissionId, next);
    await bringCoordinatorForDone(project, review, next, sessions);
    return readReviewView(project, reviewId);
  }
  requireProjectWorkspace(project);
  replaceSubmission(project, reviewId, submissionId, next);
  return readReviewView(project, reviewId);
}

/**
 * Handled threads become done. Leftovers return to tasking unless that
 * submission's tasker run is already active.
 */
function nextRetrySubmission(
  submission: Extract<ReviewSubmission, { status: "incomplete" | "failed" }>,
  split: { taskIds: string[]; openThreadIds: string[] },
  sessions: AgentSessions,
): ReviewSubmission {
  return settledSubmission(submission, split, (taskIds) => {
    if (
      submission.conversationId &&
      sessions.getActiveRun(submission.conversationId)
    ) {
      throw new IssueError("conflict", "a tasking run is already active");
    }
    return taskingSubmission(submission, taskIds);
  });
}

/**
 * Retry every incomplete or failed submission. Threads already handled
 * become done; every leftover returns to tasking in one write.
 */
export async function retryOpenReviewSubmissions(
  projectId: string,
  reviewId: string,
  body: unknown,
  sessions: AgentSessions,
): Promise<ReviewRecordView> {
  const parsed = parseRetryReviewSubmissionBody(body);
  if (!parsed.ok) throw new IssueError("validation", parsed.message);
  const project = requireProject(projectId);
  const review = readReviewView(project, reviewId);
  const storyId = requireReviewStory(review);
  assertStoryOpenForTasking(storyId);

  let finished: Extract<ReviewSubmission, { status: "done" }>[] = [];
  updateStoredReview(project, reviewId, (current) => {
    assertStoryOpenForTasking(storyId);
    assertNoTasking(current.submissions);
    const issues = readAll().issues;
    const done: Extract<ReviewSubmission, { status: "done" }>[] = [];
    let any = false;
    let needsLaunch = false;
    const submissions = current.submissions.map((submission) => {
      if (!isRetryableSubmission(submission)) return submission;
      any = true;
      const split = submissionThreads(review, submission, issues);
      const next = nextRetrySubmission(submission, split, sessions);
      if (next.status === "done") done.push(next);
      if (next.status === "tasking") needsLaunch = true;
      return next;
    });
    if (!any) throw new IssueError("validation", NO_RETRYABLE_SUBMISSION_ERROR);
    if (needsLaunch) requireProjectWorkspace(project);
    finished = done;
    return {
      ...current,
      updatedAt: new Date().toISOString(),
      submissions,
    };
  });

  for (const done of finished) {
    await bringCoordinatorForDone(project, review, done, sessions);
  }
  return readReviewView(project, reviewId);
}

/** The review a review-channel conversation is anchored to, if it still exists. */
export function reviewOfConversation(
  meta: ConversationMeta,
  issues: Issue[],
): ReviewRecordView | undefined {
  if (meta.channel !== "review" || meta.issueId === undefined) return undefined;
  const reviewId = meta.issueId;
  if (!issues.some((issue) => issue.id === reviewId && issue.kind === "review")) {
    return undefined;
  }
  return readReviewView(meta.projectId, reviewId, issues);
}

function findTaskingSubmission(conversationId: string):
  | {
      projectId: string;
      review: ReviewRecordView;
      submission: ReviewSubmission;
    }
  | undefined {
  const meta = readConversationMeta(conversationId);
  const review = reviewOfConversation(meta, readAll().issues);
  if (!review) return undefined;
  const submission = review.submissions.find(
    (item) => item.conversationId === conversationId && item.status === "tasking",
  );
  if (!submission) return undefined;
  return { projectId: meta.projectId, review, submission };
}

export async function classifyReviewTaskingRun(
  conversationId: string,
  outcome: TaskingRunOutcome,
  sessions: ConversationMessageSessions,
): Promise<boolean> {
  const found = findTaskingSubmission(conversationId);
  if (!found) return false;
  const { projectId, review, submission } = found;
  const issues = readAll().issues;

  let saved: ReviewSubmission | undefined;
  updateStoredReview(projectId, review.id, (current) => {
    const index = current.submissions.findIndex(
      (item) => item.id === submission.id && item.status === "tasking",
    );
    if (index < 0) return current;
    const currentSubmission = current.submissions[index]!;
    const split = submissionThreads(review, currentSubmission, issues);
    const submissions = current.submissions.slice();
    const next = settledSubmission(currentSubmission, split, (taskIds) =>
      outcome.status === "finished"
        ? incompleteSubmission(currentSubmission, taskIds)
        : failedSubmission(currentSubmission, failureReason(outcome), taskIds),
    );
    saved = next;
    submissions[index] = next;
    return {
      ...current,
      updatedAt: new Date().toISOString(),
      submissions,
    };
  });
  if (!saved) return false;

  if (saved.status === "done") {
    await bringCoordinatorForDone(projectId, review, saved, sessions);
  }
  return true;
}

export function failReviewTaskingClassification(
  conversationId: string,
  message: string,
): boolean {
  const found = findTaskingSubmission(conversationId);
  if (!found) return false;
  const reason = message.trim() || "review tasking classification failed";
  const split = submissionThreads(found.review, found.submission, readAll().issues);
  replaceSubmission(
    found.projectId,
    found.review.id,
    found.submission.id,
    settledSubmission(found.submission, split, (taskIds) =>
      failedSubmission(found.submission, reason, taskIds),
    ),
  );
  return true;
}

export function taskerAgentRunStatus(
  live: boolean,
  status: ReviewSubmission["status"],
): AgentRun["status"] {
  if (live) return "running";
  if (status === "failed") return "error";
  if (status === "done" || status === "incomplete") return "completed";
  return "unknown";
}

/**
 * Resolving, unresolving, or linking a thread can finish its submission.
 * A `done` submission stays done. A `tasking` submission waits for the run.
 */
export function reevaluateReviewSubmissions(reviewId: string, threadId: string): void {
  const review = readReviewOrThrow(reviewId);
  const affected = review.submissions.some(
    (submission) =>
      isRetryableSubmission(submission) && submission.threadIds.includes(threadId),
  );
  if (!affected) return;
  const issues = readAll().issues;
  const threads = readComments(reviewId, issues).threads;
  updateStoredReview(review.partOf, reviewId, (current) => {
    let changed = false;
    const submissions = current.submissions.map((submission) => {
      if (
        !isRetryableSubmission(submission) ||
        !submission.threadIds.includes(threadId)
      ) {
        return submission;
      }
      const split = splitSubmissionThreads(submission, threads, issues, review.story);
      const next = settledSubmission(submission, split, () => submission);
      if (next === submission) return submission;
      changed = true;
      return next;
    });
    if (!changed) return current;
    return {
      ...current,
      updatedAt: new Date().toISOString(),
      submissions,
    };
  });
}

function reviewTaskerAgentRun(
  meta: ConversationMeta,
  issueId: string,
  submission: ReviewSubmission,
): AgentRun {
  const status = taskerAgentRunStatus(isRunLive(meta.id), submission.status);
  return {
    delegationId: reviewTaskerDelegationId(meta.id),
    agentId: meta.agentId ?? meta.id,
    role: REVIEW_TASKER_ROLE,
    model: meta.model,
    issueId,
    parentCallId: meta.id,
    conversationId: meta.id,
    startedAt: meta.createdAt,
    status,
    ...((status === "completed" || status === "error")
      ? { endedAt: meta.updatedAt }
      : {}),
    isResume: false,
  };
}

/** Review conversations named by one of that review's submissions, with that submission. */
function taskerConversations(
  issueId: string,
  issues?: Issue[],
): { meta: ConversationMeta; submission: ReviewSubmissionView }[] {
  const graph = issues ?? readAll().issues;
  const review = graph.find((issue) => issue.id === issueId);
  if (review?.kind !== "review") return [];
  const submissions = presentSubmissions(review, graph);
  return listConversations().flatMap((meta) => {
    if (meta.issueId !== issueId || meta.channel !== "review") return [];
    const submission = submissions.find((item) => item.conversationId === meta.id);
    return submission ? [{ meta, submission }] : [];
  });
}

/** Every tasker conversation a submission started on the review. */
export function reviewTaskerConversationIds(
  reviewId: string,
  issues?: Issue[],
): string[] {
  return taskerConversations(reviewId, issues).map(({ meta }) => meta.id);
}

/** One agent run per tasker conversation a submission started on the review. */
export function reviewTaskerRunsForIssue(issueId: string, issues?: Issue[]): AgentRun[] {
  return taskerConversations(issueId, issues).map(({ meta, submission }) =>
    reviewTaskerAgentRun(meta, issueId, submission),
  );
}
