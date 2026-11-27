import { Link } from "react-router-dom";
import { reviewIssuePath } from "@/features/reviews/lib/links";
import { useIssueTitle } from "../hooks/use-issue-title";

/**
 * One sentence naming the review that owns an open outline draft.
 * The link opens that review.
 */
export function OutlineOpenDraftSentence({
  projectId,
  reviewId,
  lead,
  testId,
  id,
  className,
}: {
  projectId: string;
  reviewId: string;
  lead: string;
  testId: string;
  id?: string;
  className: string;
}) {
  const label = useIssueTitle(reviewId);
  return (
    <p id={id} data-testid={testId} className={className}>
      {lead}{" "}
      <Link
        to={reviewIssuePath(projectId, reviewId)}
        className="text-primary hover:underline"
      >
        {label}
      </Link>
      .
    </p>
  );
}

/**
 * Planning tab: saved-body writes wait on the open review draft.
 */
export function OutlineReviewDraftNote({
  projectId,
  reviewId,
}: {
  projectId: string;
  reviewId: string;
}) {
  return (
    <OutlineOpenDraftSentence
      projectId={projectId}
      reviewId={reviewId}
      lead="Outline body saves are held for an open draft from"
      testId="outline-review-draft-note"
      className="border-b border-border px-4 py-3 text-sm text-muted-foreground"
    />
  );
}
