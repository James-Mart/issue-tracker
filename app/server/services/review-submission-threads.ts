import type { Issue, ThreadView } from "../schemas.js";
import type {
  ReviewSubmission,
  ReviewSubmissionView,
} from "../schemas/review.js";
import { TASKING_INCOMPLETE_REASON } from "../review-submission-status.js";
import { readComments } from "./comment-append.js";

/**
 * A submitted thread is handled when it is resolved, or linked to a Task
 * created at or after the submission. Everything else is still open.
 */
export function splitSubmissionThreads(
  submission: { at: string; threadIds: readonly string[] },
  threads: readonly ThreadView[],
  issues: readonly Issue[],
  storyId: string,
): { taskIds: string[]; openThreadIds: string[] } {
  const byRoot = new Map(threads.map((thread) => [thread.rootId, thread]));
  const createdAt = new Map<string, string>();
  for (const issue of issues) {
    if (issue.kind === "task" && issue.partOf === storyId) {
      createdAt.set(issue.id, issue.createdAt);
    }
  }
  const taskIds: string[] = [];
  const openThreadIds: string[] = [];
  const seen = new Set<string>();
  for (const threadId of submission.threadIds) {
    const thread = byRoot.get(threadId);
    const linked = thread?.linkedTaskId;
    const linkedAt = linked ? createdAt.get(linked) : undefined;
    const linkedNew =
      linked !== undefined && linkedAt !== undefined && linkedAt >= submission.at;
    if (linkedNew && linked && !seen.has(linked)) {
      seen.add(linked);
      taskIds.push(linked);
    }
    if (linkedNew || thread?.state === "resolved") continue;
    openThreadIds.push(threadId);
  }
  return { taskIds, openThreadIds };
}

export function submissionThreads(
  storyId: string,
  submission: { at: string; threadIds: readonly string[] },
  issues: Issue[],
): { taskIds: string[]; openThreadIds: string[] } {
  return splitSubmissionThreads(
    submission,
    readComments(storyId, issues).threads,
    issues,
    storyId,
  );
}

function withoutLegacyIncompleteError(
  submission: Extract<ReviewSubmission, { status: "failed" }>,
): Extract<ReviewSubmission, { status: "incomplete" }> {
  const { error: _error, status: _status, ...rest } = submission;
  return { ...rest, status: "incomplete" };
}

/** Read model: legacy incomplete-tasking failures, plus open threads and round. */
export function presentSubmissions(
  storyId: string,
  submissions: readonly ReviewSubmission[],
  issues: Issue[],
): ReviewSubmissionView[] {
  const needsThreads = submissions.some((submission) => submission.status !== "done");
  const threads = needsThreads ? readComments(storyId, issues).threads : [];
  return submissions.map((submission, index) => {
    if (submission.status === "done") return submission;
    const { openThreadIds } = splitSubmissionThreads(
      submission,
      threads,
      issues,
      storyId,
    );
    const open = { round: index + 1, openThreadIds };
    if (
      submission.status === "failed" &&
      submission.error === TASKING_INCOMPLETE_REASON
    ) {
      return { ...withoutLegacyIncompleteError(submission), ...open };
    }
    return { ...submission, ...open };
  });
}
