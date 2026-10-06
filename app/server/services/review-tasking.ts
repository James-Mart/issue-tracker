import { randomUUID } from "crypto";
import type { AgentRun, ConversationMeta, Issue } from "../schemas.js";
import type {
  ReviewRecordView,
  ReviewSubmission,
  ReviewSubmissionView,
} from "../schemas/review.js";
import {
  parseRetryReviewSubmissionBody,
  parseSubmitReviewBody,
} from "../schemas/review.js";
import type { AgentRunStatus } from "./agent-sdk.js";
import type { AgentSessions } from "./agent-sessions.js";
import { resumeCoordinator } from "./bring-in-coordinator.js";
import type { ConversationMessageSessions } from "./conversation-message.js";
import {
  createConversation,
  deleteConversation,
  listConversations,
  readConversation,
  startConversationPrompt,
} from "./conversations.js";
import { IssueError } from "./errors.js";
import { appendComment, readAll, readComments, readIssueOrThrow } from "./issues.js";
import { submittableRootIds } from "../../src/features/reviews/lib/review-submittable.js";
import { isRetryableSubmission } from "../review-submission-status.js";
import { ancestorChain, nearestImplementingWorkRootId } from "./subtree.js";
import {
  splitSubmissionThreads,
  submissionThreads,
} from "./review-submission-threads.js";
import { requireProjectWorkspace } from "./project-workspace.js";
import { requireProject } from "./require-project.js";
import { isRunLive } from "./run-live.js";
import {
  listReviewViews,
  readReviewView,
  storedReviewsForStory,
  updateStoredReview,
} from "./reviews.js";
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
  storyId: string,
  submissions: readonly ReviewSubmission[],
): string[] {
  return submittableRootIds(readComments(storyId).threads, submissions);
}

function taskingPrompt(
  storyId: string,
  threadIds: string[],
  summaryCommentId: string | undefined,
): string {
  const lines = [
    loadRoleBody(REVIEW_TASKER_ROLE),
    "",
    `Story: ${storyId}`,
    `Threads: ${threadIds.join(", ")}`,
  ];
  if (summaryCommentId) lines.push(`Summary comment: ${summaryCommentId}`);
  return lines.join("\n");
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
  reviewId: string,
  storyId: string,
  submission: ReviewSubmission,
  split: { taskIds: string[]; openThreadIds: string[] },
  sessions: ConversationMessageSessions,
): Promise<boolean> {
  const next = settledSubmission(submission, split, () => submission);
  if (next.status !== "done") return false;
  replaceSubmission(projectId, reviewId, submission.id, next);
  await bringCoordinatorForDone(projectId, reviewId, storyId, next, sessions);
  return true;
}

function reviewForStory(
  projectId: string,
  storyId: string,
  issues: Issue[],
): ReviewRecordView | undefined {
  return listReviewViews(projectId, storyId, issues).reviews[0];
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

function assertNoTasking(submissions: readonly { status: string }[]): void {
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
    submissions[index] = next;
    return {
      ...current,
      updatedAt: new Date().toISOString(),
      submissions,
    };
  });
}

async function markStartFailed(
  projectId: string,
  reviewId: string,
  storyId: string,
  submission: ReviewSubmission,
  message: string,
): Promise<void> {
  const split = submissionThreads(storyId, submission, readAll().issues);
  replaceSubmission(
    projectId,
    reviewId,
    submission.id,
    settledSubmission(submission, split, (taskIds) =>
      failedSubmission(submission, message, taskIds),
    ),
  );
}

export async function submitReview(
  projectId: string,
  reviewId: string,
  body: unknown,
): Promise<ReviewRecordView> {
  const parsed = parseSubmitReviewBody(body);
  if (!parsed.ok) throw new IssueError("validation", parsed.message);

  const project = requireProject(projectId);
  const review = readReviewView(project, reviewId);
  const storyId = review.target.storyId;
  assertStoryOpenForTasking(storyId);
  assertNoTasking(review.submissions);
  const threadIds = submittableThreadIds(storyId, review.submissions);
  if (threadIds.length === 0) {
    throw new IssueError("validation", NO_READY_THREADS_ERROR);
  }
  requireProjectWorkspace(project);

  const summary = parsed.body.summary?.trim() ?? "";
  const summaryComment = summary
    ? await appendComment(storyId, { role: "human", body: summary })
    : undefined;

  const submission: ReviewSubmission = {
    id: randomUUID(),
    at: new Date().toISOString(),
    ...(summaryComment ? { summaryCommentId: summaryComment.id } : {}),
    threadIds,
    status: "tasking",
  };

  updateStoredReview(project, reviewId, (current) => {
    assertStoryOpenForTasking(storyId);
    assertNoTasking(current.submissions);
    const readyNow = new Set(submittableThreadIds(storyId, current.submissions));
    if (threadIds.some((id) => !readyNow.has(id))) {
      throw new IssueError(
        "conflict",
        "ready threads changed before the submission was recorded",
      );
    }
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
  reviewId: string,
  storyId: string,
  submission: ReviewSubmission,
  conversationId: string,
  prompt: string,
  model: string,
  sessions: AgentSessions,
  persistPrompt: boolean,
): Promise<void> {
  try {
    const started = await startConversationPrompt(
      conversationId,
      prompt,
      model,
      sessions,
      persistPrompt ? undefined : { persistPrompt: false },
    );
    if (!started.ok) {
      await markStartFailed(
        projectId,
        reviewId,
        storyId,
        submission,
        started.message,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markStartFailed(projectId, reviewId, storyId, submission, message);
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
  reviewId: string,
  storyId: string,
  submission: ReviewSubmission,
  sessions: ConversationMessageSessions,
): Promise<void> {
  if (!submissionNeedsCoordinator(submission)) return;
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
      `coordinator was not brought in after review ${reviewId} on story ${storyId}`,
      err,
    );
    return;
  }
  replaceSubmission(projectId, reviewId, submission.id, {
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

  const storyId = review.target.storyId;
  try {
    const story = assertStoryOpenForTasking(storyId);
    const linked = submissionThreads(storyId, submission, readAll().issues);
    if (
      await completeWhenSettled(
        projectId,
        reviewId,
        storyId,
        submission,
        linked,
        sessions,
      )
    ) {
      return;
    }

    const threadIds = linked.openThreadIds;
    const prompt = taskingPrompt(storyId, threadIds, submission.summaryCommentId);
    const model = loadRoleModelPin(REVIEW_TASKER_ROLE);
    let current: ReviewSubmission = submission;
    const persisted = submission.conversationId !== undefined;
    if (!submission.conversationId) {
      const meta = await createConversation({
        title: `Tasking ${story.title}`,
        projectId,
        model,
        issueId: storyId,
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
      reviewId,
      storyId,
      current,
      conversationId,
      prompt,
      model,
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
      await markStartFailed(projectId, reviewId, storyId, latest, message);
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
  const storyId = review.target.storyId;
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
  const split = submissionThreads(storyId, submission, readAll().issues);
  const next = nextRetrySubmission(submission, split, sessions);
  if (next.status === "done") {
    replaceSubmission(project, reviewId, submissionId, next);
    await bringCoordinatorForDone(project, reviewId, storyId, next, sessions);
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
  const storyId = review.target.storyId;
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
      const split = submissionThreads(storyId, submission, issues);
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
    await bringCoordinatorForDone(project, reviewId, storyId, done, sessions);
  }
  return readReviewView(project, reviewId);
}

function findTaskingSubmission(conversationId: string):
  | {
      projectId: string;
      storyId: string;
      review: ReviewRecordView;
      submission: ReviewSubmission;
    }
  | undefined {
  const { meta } = readConversation(conversationId);
  if (meta.channel !== "review" || meta.issueId === undefined) return undefined;
  const review = reviewForStory(meta.projectId, meta.issueId, readAll().issues);
  if (!review) return undefined;
  const submission = review.submissions.find(
    (item) => item.conversationId === conversationId && item.status === "tasking",
  );
  if (!submission) return undefined;
  return {
    projectId: meta.projectId,
    storyId: meta.issueId,
    review,
    submission,
  };
}

export async function classifyReviewTaskingRun(
  conversationId: string,
  outcome: TaskingRunOutcome,
  sessions: ConversationMessageSessions,
): Promise<boolean> {
  const found = findTaskingSubmission(conversationId);
  if (!found) return false;
  const { projectId, storyId, review, submission } = found;
  const issues = readAll().issues;

  let saved: ReviewSubmission | undefined;
  updateStoredReview(projectId, review.id, (current) => {
    const index = current.submissions.findIndex(
      (item) => item.id === submission.id && item.status === "tasking",
    );
    if (index < 0) return current;
    const currentSubmission = current.submissions[index]!;
    const split = submissionThreads(storyId, currentSubmission, issues);
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
    await bringCoordinatorForDone(projectId, review.id, storyId, saved, sessions);
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
  const split = submissionThreads(
    found.storyId,
    found.submission,
    readAll().issues,
  );
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

function agentRunStatus(
  live: boolean,
  submission: ReviewSubmission,
): AgentRun["status"] {
  if (live) return "running";
  if (submission.status === "failed") return "error";
  if (submission.status === "done" || submission.status === "incomplete") {
    return "completed";
  }
  return "unknown";
}

/**
 * Resolving, unresolving, or linking a thread can finish its submission.
 * A `done` submission stays done. A `tasking` submission waits for the run.
 */
export function reevaluateStorySubmissions(storyId: string, threadId: string): void {
  const issues = readAll().issues;
  const projectId = ancestorChain(storyId, issues)[0]!.id;
  const reviews = storedReviewsForStory(projectId, storyId);
  const affected = reviews.some((review) =>
    review.submissions.some(
      (submission) =>
        isRetryableSubmission(submission) && submission.threadIds.includes(threadId),
    ),
  );
  if (!affected) return;
  const threads = readComments(storyId, issues).threads;
  for (const review of reviews) {
    updateStoredReview(projectId, review.id, (current) => {
      let changed = false;
      const submissions = current.submissions.map((submission) => {
        if (
          !isRetryableSubmission(submission) ||
          !submission.threadIds.includes(threadId)
        ) {
          return submission;
        }
        const split = splitSubmissionThreads(submission, threads, issues, storyId);
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
}

function reviewTaskerAgentRun(
  meta: ConversationMeta,
  issueId: string,
  submission: ReviewSubmission,
): AgentRun {
  const status = agentRunStatus(isRunLive(meta.id), submission);
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

/** Story conversations named by a review submission, with that submission. */
function taskerConversations(
  storyId: string,
  issues?: Issue[],
): { meta: ConversationMeta; submission: ReviewSubmissionView }[] {
  const graph = issues ?? readAll().issues;
  const submissionsByProject = new Map<string, ReviewSubmissionView[]>();
  const found: { meta: ConversationMeta; submission: ReviewSubmissionView }[] = [];
  for (const meta of listConversations()) {
    if (meta.issueId !== storyId || meta.channel !== "review") continue;
    let submissions = submissionsByProject.get(meta.projectId);
    if (submissions === undefined) {
      submissions = reviewForStory(meta.projectId, storyId, graph)?.submissions ?? [];
      submissionsByProject.set(meta.projectId, submissions);
    }
    const submission = submissions.find((item) => item.conversationId === meta.id);
    if (submission) found.push({ meta, submission });
  }
  return found;
}

/** Every tasker conversation a review submission started on the Story. */
export function reviewTaskerConversationIds(
  storyId: string,
  issues?: Issue[],
): string[] {
  return taskerConversations(storyId, issues).map(({ meta }) => meta.id);
}

/** One agent run per tasker conversation a review submission started on the Story. */
export function reviewTaskerRunsForIssue(issueId: string, issues?: Issue[]): AgentRun[] {
  return taskerConversations(issueId, issues).map(({ meta, submission }) =>
    reviewTaskerAgentRun(meta, issueId, submission),
  );
}
