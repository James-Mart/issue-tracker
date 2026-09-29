import { randomUUID } from "crypto";
import type { AgentRun, ConversationMeta, Issue } from "../schemas.js";
import type {
  ReviewRecordView,
  ReviewSubmission,
} from "../schemas/review.js";
import {
  parseRetryReviewSubmissionBody,
  parseSubmitReviewBody,
} from "../schemas/review.js";
import type { AgentRunStatus } from "./agent-sdk.js";
import type { AgentSessions } from "./agent-sessions.js";
import {
  bringInCoordinator,
  reviewAppendedTasksMessage,
} from "./bring-in-coordinator.js";
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
import { ancestorChain, nearestImplementingWorkRootId } from "./subtree.js";
import { requireProjectWorkspace } from "./project-workspace.js";
import { requireProject } from "./require-project.js";
import { isRunLive } from "./run-live.js";
import {
  listReviewViews,
  readReviewView,
  updateStoredReview,
} from "./reviews.js";
import { loadRoleBody, loadRoleModelPin } from "./role-bodies.js";

export const REVIEW_TASKER_ROLE = "issue-tracker-review-tasker";

export const NO_READY_THREADS_ERROR = "no threads are ready to task";

export const SUBMISSION_TASKING_ERROR = "a submission is already tasking";

export const TASKING_INCOMPLETE_REASON =
  "not every submitted thread links to a new Task";

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

function readyThreadIds(storyId: string): string[] {
  return readComments(storyId)
    .threads.filter((thread) => thread.readyToTask)
    .map((thread) => thread.rootId);
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
    conversationId: submission.conversationId,
  };
}

function taskingSubmission(
  submission: ReviewSubmission,
  taskIds: string[] | undefined,
): ReviewSubmission {
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
): ReviewSubmission {
  return {
    ...submissionBase(submission),
    status: "done",
    taskIds,
  };
}

function linkedNewTaskIds(
  storyId: string,
  submission: ReviewSubmission,
  issues: Issue[],
): { taskIds: string[]; unlinkedThreadIds: string[] } {
  const byRoot = new Map(
    readComments(storyId, issues).threads.map((thread) => [thread.rootId, thread]),
  );
  const createdAt = new Map<string, string>();
  for (const issue of issues) {
    if (issue.kind === "task" && issue.partOf === storyId) {
      createdAt.set(issue.id, issue.createdAt);
    }
  }
  const taskIds: string[] = [];
  const unlinkedThreadIds: string[] = [];
  const seen = new Set<string>();
  for (const threadId of submission.threadIds) {
    const linked = byRoot.get(threadId)?.linkedTaskId;
    const at = linked ? createdAt.get(linked) : undefined;
    if (linked && at !== undefined && at >= submission.at) {
      if (!seen.has(linked)) {
        seen.add(linked);
        taskIds.push(linked);
      }
      continue;
    }
    unlinkedThreadIds.push(threadId);
  }
  return { taskIds, unlinkedThreadIds };
}

function failureReason(outcome: TaskingRunOutcome): string {
  if (outcome.status === "finished") return TASKING_INCOMPLETE_REASON;
  const message = outcome.errorMessage?.trim();
  if (message) return message;
  return `tasking run ${outcome.status}`;
}

function reviewForStory(
  projectId: string,
  storyId: string,
): ReviewRecordView | undefined {
  return listReviewViews(projectId, storyId).reviews[0];
}

function submissionOnStory(
  projectId: string,
  storyId: string,
  conversationId: string,
): ReviewSubmission | undefined {
  return reviewForStory(projectId, storyId)?.submissions.find(
    (item) => item.conversationId === conversationId,
  );
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
  const { taskIds } = linkedNewTaskIds(storyId, submission, readAll().issues);
  replaceSubmission(
    projectId,
    reviewId,
    submission.id,
    failedSubmission(submission, message, taskIds),
  );
}

export async function submitReview(
  projectId: string,
  reviewId: string,
  body: unknown,
  sessions: AgentSessions,
): Promise<ReviewRecordView> {
  const parsed = parseSubmitReviewBody(body);
  if (!parsed.ok) throw new IssueError("validation", parsed.message);

  const project = requireProject(projectId);
  const review = readReviewView(project, reviewId);
  const storyId = review.target.storyId;
  const story = assertStoryOpenForTasking(storyId);
  assertNoTasking(review.submissions);
  const threadIds = readyThreadIds(storyId);
  if (threadIds.length === 0) {
    throw new IssueError("validation", NO_READY_THREADS_ERROR);
  }
  requireProjectWorkspace(project);

  const summary = parsed.body.summary?.trim() ?? "";
  const summaryComment = summary
    ? await appendComment(storyId, { role: "human", body: summary })
    : undefined;
  const prompt = taskingPrompt(storyId, threadIds, summaryComment?.id);
  const model = loadRoleModelPin(REVIEW_TASKER_ROLE);
  const meta = await createConversation({
    title: `Tasking ${story.title}`,
    projectId: project,
    model,
    issueId: storyId,
    channel: "review",
    message: prompt,
  });

  const submission: ReviewSubmission = {
    id: randomUUID(),
    at: new Date().toISOString(),
    ...(summaryComment ? { summaryCommentId: summaryComment.id } : {}),
    threadIds,
    conversationId: meta.id,
    status: "tasking",
  };

  try {
    updateStoredReview(project, reviewId, (current) => {
      assertStoryOpenForTasking(storyId);
      assertNoTasking(current.submissions);
      const readyNow = new Set(readyThreadIds(storyId));
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
  } catch (err) {
    await deleteConversation(meta.id);
    throw err;
  }

  await launchTasking(
    project,
    reviewId,
    storyId,
    submission,
    meta.id,
    prompt,
    model,
    sessions,
    false,
  );

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
    throw err;
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
  if (submission.status !== "failed") {
    throw new IssueError(
      "validation",
      `submission "${submissionId}" is ${submission.status}`,
    );
  }
  const { unlinkedThreadIds, taskIds } = linkedNewTaskIds(
    storyId,
    submission,
    readAll().issues,
  );
  if (unlinkedThreadIds.length === 0) {
    throw new IssueError(
      "validation",
      `submission "${submissionId}" has no unlinked threads`,
    );
  }
  if (sessions.getActiveRun(submission.conversationId)) {
    throw new IssueError("conflict", "a tasking run is already active");
  }
  requireProjectWorkspace(project);

  const next = taskingSubmission(submission, taskIds);
  replaceSubmission(project, reviewId, submissionId, next);

  const prompt = taskingPrompt(
    storyId,
    unlinkedThreadIds,
    submission.summaryCommentId,
  );
  await launchTasking(
    project,
    reviewId,
    storyId,
    next,
    submission.conversationId,
    prompt,
    loadRoleModelPin(REVIEW_TASKER_ROLE),
    sessions,
    true,
  );

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
  const review = reviewForStory(meta.projectId, meta.issueId);
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
    const { taskIds, unlinkedThreadIds } = linkedNewTaskIds(
      storyId,
      currentSubmission,
      issues,
    );
    const submissions = current.submissions.slice();
    const next =
      unlinkedThreadIds.length === 0
        ? doneSubmission(currentSubmission, taskIds)
        : failedSubmission(
            currentSubmission,
            failureReason(outcome),
            taskIds,
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
    try {
      const workRootId = nearestImplementingWorkRootId(
        ancestorChain(storyId, issues),
      );
      if (workRootId === undefined) {
        throw new Error(`story "${storyId}" has no implementing work root`);
      }
      await bringInCoordinator(
        workRootId,
        reviewAppendedTasksMessage(review.id, storyId, saved.taskIds),
        sessions,
      );
    } catch (err) {
      // Tasking already recorded done. A coordinator delivery failure must
      // not roll that back; the error is logged for follow-up.
      console.error(
        `coordinator was not brought in after review ${review.id} on story ${storyId}`,
        err,
      );
    }
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
  const { taskIds } = linkedNewTaskIds(
    found.storyId,
    found.submission,
    readAll().issues,
  );
  replaceSubmission(
    found.projectId,
    found.review.id,
    found.submission.id,
    failedSubmission(found.submission, reason, taskIds),
  );
  return true;
}

function agentRunStatus(
  live: boolean,
  submission: ReviewSubmission | undefined,
): AgentRun["status"] {
  if (live) return "running";
  if (submission?.status === "failed") return "error";
  if (submission?.status === "done") return "completed";
  return "unknown";
}

export function reviewTaskerAgentRun(meta: ConversationMeta): AgentRun | undefined {
  if (meta.channel !== "review" || meta.issueId === undefined) return undefined;
  const submission = submissionOnStory(
    meta.projectId,
    meta.issueId,
    meta.id,
  );
  const status = agentRunStatus(isRunLive(meta.id), submission);
  return {
    delegationId: reviewTaskerDelegationId(meta.id),
    agentId: meta.agentId ?? meta.id,
    role: REVIEW_TASKER_ROLE,
    model: meta.model,
    issueId: meta.issueId,
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

export function reviewTaskerRunsForIssue(issueId: string): AgentRun[] {
  const runs: AgentRun[] = [];
  for (const meta of listConversations()) {
    if (meta.issueId !== issueId) continue;
    const run = reviewTaskerAgentRun(meta);
    if (run) runs.push(run);
  }
  return runs;
}
