import type { ReviewSubmission, ReviewSubmissionView } from "@server/schemas";
import { isRetryableSubmission } from "@server/review-submission-status";

/** Visible reason when a merged Story cannot accept appended Tasks. */
export const MERGED_STORY_SUBMIT_REASON =
  "Story is merged — Tasks can't be appended";

/** How often to re-read a review while a submission is still tasking. */
export const REVIEW_SUBMISSION_POLL_MS = 3_000;

export type ReviewSubmitAction = {
  label: string;
  disabled: boolean;
  readyCount: number | undefined;
  reason?: string;
};

export type ReviewRetryAction = {
  submissionIds: string[];
  disabled: boolean;
  reason?: string;
};

export type ReviewFailureLine = {
  submissionId: string;
  message: string;
};

export type ReviewOpenRound = {
  submissionId: string;
  round: number;
  threadIds: readonly string[];
};

/** Submit, Retry, tasking, failures, and open rounds can all show together. */
export type ReviewSubmitHeader = {
  /** Set while any submission is tasking. Submit is omitted for that time. */
  taskingLabel?: string;
  submit?: ReviewSubmitAction;
  /** One control for every incomplete or failed submission. */
  retry?: ReviewRetryAction;
  failures: ReviewFailureLine[];
  openRounds: ReviewOpenRound[];
};

/** Local submit mark, before the server records a round. */
type PendingSubmit = {
  id: string;
  at: "pending";
  status: "tasking";
  threadIds: string[];
};

type HeaderSubmission = ReviewSubmissionView | PendingSubmit;

function isPendingSubmit(submission: { at: string }): submission is PendingSubmit {
  return submission.at === "pending";
}

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

export function openThreadsHeadline(count: number): string {
  return `${count} submitted ${count === 1 ? "thread" : "threads"} still open`;
}

function failureLines(submissions: readonly HeaderSubmission[]): ReviewFailureLine[] {
  const lines: ReviewFailureLine[] = [];
  for (const submission of submissions) {
    if (submission.status !== "failed") continue;
    lines.push({ submissionId: submission.id, message: submission.error });
  }
  return lines;
}

function openRounds(submissions: readonly HeaderSubmission[]): ReviewOpenRound[] {
  const rounds: ReviewOpenRound[] = [];
  for (const submission of submissions) {
    if (submission.status === "done" || isPendingSubmit(submission)) continue;
    if (submission.openThreadIds.length === 0) continue;
    rounds.push({
      submissionId: submission.id,
      round: submission.round,
      threadIds: submission.openThreadIds,
    });
  }
  return rounds;
}

/**
 * Workbench header from submission state. Tasking replaces Submit. Incomplete
 * and failed never do: Submit stays for threads that are ready, one Retry
 * covers every incomplete or failed submission, and each failed run keeps its
 * error line. Open threads from every submission that is not done feed the
 * disclosure.
 */
export function reviewSubmitHeader(input: {
  merged: boolean;
  readyCount: number | undefined;
  submissions: readonly HeaderSubmission[];
}): ReviewSubmitHeader {
  const tasking = input.submissions.filter((submission) => submission.status === "tasking");
  const retryable = input.submissions.filter(isRetryableSubmission);
  const reason = mergedReason(input.merged);
  const readyCount = input.readyCount;
  const retry =
    retryable.length === 0
      ? undefined
      : {
          submissionIds: retryable.map((submission) => submission.id),
          disabled: reason !== undefined || tasking.length > 0,
          ...(reason ? { reason } : {}),
        };
  const shared = {
    ...(retry ? { retry } : {}),
    failures: failureLines(input.submissions),
    openRounds: openRounds(input.submissions),
  };
  if (tasking.length > 0) {
    const threadCount = tasking.reduce((sum, submission) => sum + submission.threadIds.length, 0);
    return { taskingLabel: taskingLabel(threadCount), ...shared };
  }
  return {
    submit: {
      readyCount,
      label: readyCount === undefined ? "Submit review" : submitReviewLabel(readyCount),
      disabled: reason !== undefined || readyCount === undefined || readyCount === 0,
      ...(reason ? { reason } : {}),
    },
    ...shared,
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

function taskingFromRetryable(
  submission: Extract<ReviewSubmissionView, { status: "failed" | "incomplete" }>,
): Extract<ReviewSubmissionView, { status: "tasking" }> {
  if (submission.status === "failed") {
    const { error: _error, ...rest } = submission;
    return { ...rest, status: "tasking" };
  }
  return { ...submission, status: "tasking" };
}

/**
 * Tasking the moment submit or retry is confirmed. A server tasking record
 * replaces the local submit mark; a retry mark stands in until that record
 * is tasking again.
 */
export function acknowledgedSubmissions(
  submissions: readonly ReviewSubmissionView[],
  pendingThreadIds: readonly string[] | undefined,
  retryingIds: readonly string[] | undefined,
): HeaderSubmission[] {
  const retrying = new Set(retryingIds ?? []);
  const next = submissions.map((submission) =>
    (submission.status === "failed" || submission.status === "incomplete") &&
    retrying.has(submission.id)
      ? taskingFromRetryable(submission)
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
