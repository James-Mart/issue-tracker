import type { ConversationMeta } from "../schemas.js";
import type {
  ReviewAgentRun,
  ReviewAgentRunStatus,
  ReviewSubmissionView,
  StandardsAssessment,
} from "../schemas/review.js";
import { readComments } from "./comment-append.js";
import {
  conversationExists,
  listConversations,
  readConversation,
} from "./conversations.js";
import { isRunLive } from "./run-live.js";
import {
  latestTranscriptError,
  researcherSessionsForReview,
  REVIEW_QUESTION_ROLE,
} from "./researcher-runs.js";
import { REVIEW_TASKER_ROLE, taskerAgentRunStatus } from "./review-tasking.js";
import {
  STANDARDS_ASSESSOR_ROLE,
  standardsAgentRunStatus,
} from "./review-standards.js";
import { readReviewView } from "./reviews.js";

/**
 * First line of the question, which is the excerpt the Agents card names.
 * A blank line is absent rather than an empty string.
 */
export function questionExcerpt(body: string): string | undefined {
  const line = body.trim().split("\n")[0]?.trim() ?? "";
  return line.length > 0 ? line : undefined;
}

function withEnd(
  status: ReviewAgentRunStatus,
  updatedAt: string,
): { status: ReviewAgentRunStatus; endedAt?: string } {
  if (status === "running" || status === "unknown") return { status };
  return { status, endedAt: updatedAt };
}

function settledFromTranscript(
  meta: ConversationMeta,
): { status: ReviewAgentRunStatus; endedAt?: string } {
  if (isRunLive(meta.id)) return { status: "running" };
  const failed = latestTranscriptError(readConversation(meta.id).transcript) !== undefined;
  return withEnd(failed ? "error" : "completed", meta.updatedAt);
}

function baseRun(
  meta: ConversationMeta,
  role: string,
  lifecycle: { status: ReviewAgentRunStatus; endedAt?: string },
): ReviewAgentRun {
  return {
    conversationId: meta.id,
    role,
    model: meta.model,
    startedAt: meta.createdAt,
    ...lifecycle,
  };
}

/**
 * Top-level review conversations, oldest first. A review-channel session with
 * no role is not a record. Nested delegates are not conversations. The
 * implementing coordinator is a different channel and is not a record.
 */
export function listReviewAgentRuns(
  projectId: string,
  reviewId: string,
): ReviewAgentRun[] {
  const submissions = readReviewView(projectId, reviewId).submissions;
  const taskerByConversation = new Map<
    string,
    { submission: ReviewSubmissionView; round: number }
  >();
  const assessorByConversation = new Map<
    string,
    { submission: ReviewSubmissionView; round: number; standards: StandardsAssessment }
  >();
  submissions.forEach((submission, index) => {
    const round = index + 1;
    if (submission.conversationId && !taskerByConversation.has(submission.conversationId)) {
      taskerByConversation.set(submission.conversationId, { submission, round });
    }
    const standards = submission.standards;
    if (
      standards?.conversationId &&
      !assessorByConversation.has(standards.conversationId)
    ) {
      assessorByConversation.set(standards.conversationId, {
        submission,
        round,
        standards,
      });
    }
  });

  const researcherByConversation = new Map(
    researcherSessionsForReview(reviewId).map((session) => [
      session.conversationId,
      session.threadId,
    ]),
  );
  const commentBody = new Map(
    readComments(reviewId).messages.map((message) => [message.id, message.body]),
  );

  const runs: ReviewAgentRun[] = [];
  for (const meta of listConversations()) {
    if (meta.issueId !== reviewId || meta.channel !== "review" || !meta.role) continue;
    if (!conversationExists(meta.id)) continue;

    if (meta.role === REVIEW_TASKER_ROLE) {
      const hit = taskerByConversation.get(meta.id);
      if (!hit) continue;
      const lifecycle = withEnd(
        taskerAgentRunStatus(isRunLive(meta.id), hit.submission.status),
        meta.updatedAt,
      );
      runs.push({
        ...baseRun(meta, meta.role, lifecycle),
        round: hit.round,
        submittedAt: hit.submission.at,
        submissionId: hit.submission.id,
        submittedEntry: hit.submission.status === "done",
      });
      continue;
    }

    if (meta.role === STANDARDS_ASSESSOR_ROLE) {
      const hit = assessorByConversation.get(meta.id);
      if (!hit) continue;
      const lifecycle = withEnd(
        standardsAgentRunStatus(isRunLive(meta.id), hit.standards.status),
        meta.updatedAt,
      );
      runs.push({
        ...baseRun(meta, meta.role, lifecycle),
        round: hit.round,
        submittedAt: hit.submission.at,
        submissionId: hit.submission.id,
      });
      continue;
    }

    if (meta.role === REVIEW_QUESTION_ROLE) {
      const threadId = researcherByConversation.get(meta.id);
      if (!threadId) continue;
      const excerpt = questionExcerpt(commentBody.get(threadId) ?? "");
      runs.push({
        ...baseRun(meta, meta.role, settledFromTranscript(meta)),
        threadId,
        ...(excerpt ? { questionExcerpt: excerpt } : {}),
      });
      continue;
    }

    runs.push(baseRun(meta, meta.role, settledFromTranscript(meta)));
  }

  runs.sort(
    (a, b) =>
      a.startedAt.localeCompare(b.startedAt) ||
      a.conversationId.localeCompare(b.conversationId),
  );
  return runs;
}
