import {
  parseSubmitReviewBody,
  type ReviewRecordView,
} from "../schemas/review.js";
import { IssueError } from "./errors.js";
import { submitReviewAsTasks } from "./review-tasking.js";
import { standardsAssessmentForSubmit } from "./review-standards.js";

/** Record a tasking submission for every submittable thread. The route starts the tasker. */
export async function submitReview(
  projectId: string,
  reviewId: string,
  body: unknown,
): Promise<ReviewRecordView> {
  const parsed = parseSubmitReviewBody(body);
  if (!parsed.ok) throw new IssueError("validation", parsed.message);
  const summary = parsed.body.summary?.trim() || undefined;
  const standards = parsed.body.assessStandards
    ? standardsAssessmentForSubmit(projectId, reviewId)
    : undefined;
  return submitReviewAsTasks(projectId, reviewId, summary, standards);
}
