import type { ReviewSubmission } from "@server/schemas";

/** Visible reason when a merged Story cannot accept appended Tasks. */
export const MERGED_STORY_SUBMIT_REASON =
  "Story is merged — Tasks can't be appended";

/** How often to re-read a review while a submission is still tasking. */
export const REVIEW_SUBMISSION_POLL_MS = 3_000;

export type ReviewSubmitHeader =
  | {
      mode: "submit";
      label: string;
      disabled: boolean;
      readyCount: number | undefined;
      reason?: string;
    }
  | {
      mode: "tasking";
      label: string;
    }
  | {
      mode: "failed";
      submissionId: string;
      error: string;
      retryDisabled: boolean;
      reason?: string;
    };

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function submitReviewLabel(readyCount: number): string {
  return `Submit review (${readyCount})`;
}

export function taskingLabel(threadCount: number): string {
  return `Tasking ${countLabel(threadCount, "thread", "threads")}…`;
}

export function submitReviewDialogDetail(readyCount: number): string {
  const threads = countLabel(readyCount, "unresolved thread", "unresolved threads");
  return `Turn ${threads} into Tasks. An optional summary comment is posted to the Conversation timeline.`;
}

export function reviewSubmittedLabel(threadCount: number, taskCount: number): string {
  const threads = countLabel(threadCount, "thread", "threads");
  const tasks = taskCount === 1 ? "Task" : "Tasks";
  return `Review submitted — ${threads} → ${tasks}`;
}

function mergedReason(merged: boolean): string | undefined {
  return merged ? MERGED_STORY_SUBMIT_REASON : undefined;
}

function latestFailed(
  submissions: readonly ReviewSubmission[],
): Extract<ReviewSubmission, { status: "failed" }> | undefined {
  let latest: Extract<ReviewSubmission, { status: "failed" }> | undefined;
  for (const submission of submissions) {
    if (submission.status !== "failed") continue;
    if (!latest || submission.at > latest.at) latest = submission;
  }
  return latest;
}

/**
 * Header control for the workbench. A tasking submission wins, then the latest
 * failure, otherwise Submit review with the ready-thread count.
 */
export function reviewSubmitHeader(input: {
  merged: boolean;
  readyCount: number | undefined;
  submissions: readonly ReviewSubmission[];
}): ReviewSubmitHeader {
  const tasking = input.submissions.find((submission) => submission.status === "tasking");
  if (tasking) {
    return {
      mode: "tasking",
      label: taskingLabel(tasking.threadIds.length),
    };
  }
  const failed = latestFailed(input.submissions);
  if (failed) {
    const reason = mergedReason(input.merged);
    return {
      mode: "failed",
      submissionId: failed.id,
      error: failed.error,
      retryDisabled: reason !== undefined,
      ...(reason ? { reason } : {}),
    };
  }
  const reason = mergedReason(input.merged);
  const readyCount = input.readyCount;
  return {
    mode: "submit",
    readyCount,
    label: readyCount === undefined ? "Submit review" : submitReviewLabel(readyCount),
    disabled: reason !== undefined || readyCount === undefined || readyCount === 0,
    ...(reason ? { reason } : {}),
  };
}

export function submissionPollInterval(
  submissions: readonly { status: string }[] | undefined,
): number | false {
  return submissions?.some((submission) => submission.status === "tasking")
    ? REVIEW_SUBMISSION_POLL_MS
    : false;
}

export type ConversationTimelineItem<T> =
  | { kind: "thread"; at: string; thread: T }
  | {
      kind: "submitted";
      at: string;
      submission: Extract<ReviewSubmission, { status: "done" }>;
    };

/** Threads and finished submissions, ordered by time. A thread wins a timestamp tie. */
export function conversationTimelineItems<T extends { root: { at: string } }>(
  threads: readonly T[],
  submissions: readonly ReviewSubmission[],
): ConversationTimelineItem<T>[] {
  const items: ConversationTimelineItem<T>[] = threads.map((thread) => ({
    kind: "thread",
    at: thread.root.at,
    thread,
  }));
  for (const submission of submissions) {
    if (submission.status !== "done") continue;
    items.push({ kind: "submitted", at: submission.at, submission });
  }
  items.sort((a, b) => a.at.localeCompare(b.at) || (a.kind === "thread" ? -1 : 1));
  return items;
}

function taskingFromFailed(
  submission: Extract<ReviewSubmission, { status: "failed" }>,
): Extract<ReviewSubmission, { status: "tasking" }> {
  return {
    id: submission.id,
    at: submission.at,
    status: "tasking",
    threadIds: submission.threadIds,
    ...(submission.summaryCommentId
      ? { summaryCommentId: submission.summaryCommentId }
      : {}),
    ...(submission.conversationId ? { conversationId: submission.conversationId } : {}),
    ...(submission.taskIds ? { taskIds: submission.taskIds } : {}),
  };
}

/**
 * Tasking the moment submit or retry is confirmed. A server tasking record
 * replaces the local submit mark; a retry mark stands in until that record
 * is tasking again.
 */
export function acknowledgedSubmissions(
  submissions: readonly ReviewSubmission[],
  pendingThreadIds: readonly string[] | undefined,
  retryingId: string | undefined,
): ReviewSubmission[] {
  const next = submissions.map((submission) =>
    submission.status === "failed" && submission.id === retryingId
      ? taskingFromFailed(submission)
      : submission,
  );
  if (
    !pendingThreadIds ||
    pendingThreadIds.length === 0 ||
    next.some((submission) => submission.status === "tasking")
  ) {
    return next;
  }
  return [
    ...next,
    {
      id: "pending-submit",
      at: "pending",
      status: "tasking",
      threadIds: [...pendingThreadIds],
    },
  ];
}
