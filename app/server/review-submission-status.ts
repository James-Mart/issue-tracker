import type { ReviewSubmission } from "./schemas/review.js";

/** Stored on older failed submissions when the tasker finished with threads still open. */
export const TASKING_INCOMPLETE_REASON =
  "not every submitted thread links to a new Task";

export function isRetryableSubmission(
  submission: { status: string },
): submission is Extract<ReviewSubmission, { status: "incomplete" | "failed" }> {
  return submission.status === "incomplete" || submission.status === "failed";
}
