import type { ReviewSubmission, ThreadView } from "@server/schemas";
import { readyToTaskFrom } from "../../issues/lib/ready-to-task";

export type SubmissionClaim = Pick<ReviewSubmission, "threadIds" | "status">;

export type SubmittableThread = Pick<
  ThreadView,
  "rootId" | "kind" | "state" | "linkedTaskId"
>;

/**
 * A new Submit carries this thread when it is an open, unlinked review thread
 * that no earlier submission still claims.
 *
 * A submission claims the thread ids it froze at Submit. A `done` submission
 * releases a thread once that thread is open again — unresolved after the
 * submission became done — and the submission stays `done`. A thread left
 * open under `incomplete`, `failed`, or `tasking` stays with that submission.
 */
export function isSubmittable(
  thread: SubmittableThread,
  submissions: readonly SubmissionClaim[],
): boolean {
  if (!readyToTaskFrom(thread.kind, thread.state, thread.linkedTaskId)) {
    return false;
  }
  return !submissions.some(
    (submission) =>
      submission.threadIds.includes(thread.rootId) && submission.status !== "done",
  );
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
};

/** Comment threads whose root id passes `isSubmittable`. */
export function submittableCommentThreads<T extends CommentCarrier>(
  threads: readonly T[],
  submissions: readonly SubmissionClaim[],
): T[] {
  return threads.filter((thread) =>
    isSubmittable(
      {
        rootId: thread.root.id,
        kind: thread.kind,
        state: thread.state,
        linkedTaskId: thread.linkedTaskId,
      },
      submissions,
    ),
  );
}
