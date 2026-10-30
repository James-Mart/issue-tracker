import type { ReviewSubmission, ThreadView } from "@server/schemas";
import { readyToTaskFrom } from "../../issues/lib/ready-to-task";

export type SubmissionClaim = Pick<
  ReviewSubmission,
  "threadIds" | "status" | "summaryCommentId"
>;

export type SubmittableThread = Pick<
  ThreadView,
  "rootId" | "kind" | "state" | "linkedTaskId" | "included"
>;

/**
 * A submission claims the thread ids it froze at Submit. A `done` submission
 * releases a thread once that thread is open again — unresolved after the
 * submission became done — and the submission stays `done`. A thread left
 * open under `incomplete`, `failed`, or `tasking` stays with that submission.
 * A submission's summary comment is never feedback for a later Submit.
 */
function claimedBySubmission(
  rootId: string,
  submissions: readonly SubmissionClaim[],
): boolean {
  return submissions.some(
    (submission) =>
      submission.summaryCommentId === rootId ||
      (submission.threadIds.includes(rootId) && submission.status !== "done"),
  );
}

/**
 * An open, unlinked review thread that no unfinished submission claims.
 * Inclusion is separate: a thread can be eligible and still held back.
 */
export function isEligible(
  thread: SubmittableThread,
  submissions: readonly SubmissionClaim[],
): boolean {
  return (
    readyToTaskFrom(thread.kind, thread.state, thread.linkedTaskId) &&
    !claimedBySubmission(thread.rootId, submissions)
  );
}

/** A new Submit carries this thread when it is eligible and included. */
export function isSubmittable(
  thread: SubmittableThread,
  submissions: readonly SubmissionClaim[],
): boolean {
  return isEligible(thread, submissions) && thread.included;
}

export function submittableRootIds(
  threads: readonly SubmittableThread[],
  submissions: readonly SubmissionClaim[],
): string[] {
  return threads
    .filter((thread) => isSubmittable(thread, submissions))
    .map((thread) => thread.rootId);
}

type CommentCarrier = {
  root: { id: string };
  kind: ThreadView["kind"];
  state: ThreadView["state"];
  linkedTaskId?: string;
  included: boolean;
};

function toSubmittable(thread: CommentCarrier): SubmittableThread {
  return {
    rootId: thread.root.id,
    kind: thread.kind,
    state: thread.state,
    linkedTaskId: thread.linkedTaskId,
    included: thread.included,
  };
}

/** Eligible threads split by whether the next submission takes them. */
export function partitionSubmissionCommentThreads<T extends CommentCarrier>(
  threads: readonly T[],
  submissions: readonly SubmissionClaim[],
): { included: T[]; notIncluded: T[] } {
  const included: T[] = [];
  const notIncluded: T[] = [];
  for (const thread of threads) {
    const view = toSubmittable(thread);
    if (!isEligible(view, submissions)) continue;
    if (view.included) included.push(thread);
    else notIncluded.push(thread);
  }
  return { included, notIncluded };
}

/** Comment threads the next submission takes. */
export function submittableCommentThreads<T extends CommentCarrier>(
  threads: readonly T[],
  submissions: readonly SubmissionClaim[],
): T[] {
  return partitionSubmissionCommentThreads(threads, submissions).included;
}
