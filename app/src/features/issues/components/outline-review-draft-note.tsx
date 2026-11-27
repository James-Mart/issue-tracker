import { Link } from "react-router-dom";
import { reviewIssuePath } from "@/features/reviews/lib/links";
import { useIssuesQuery } from "../api/queries";

/**
 * Planning tab: saved-body writes wait on the open review draft.
 * The link opens the review that owns it.
 */
export function OutlineReviewDraftNote({
  projectId,
  reviewId,
}: {
  projectId: string;
  reviewId: string;
}) {
  const issues = useIssuesQuery();
  const title = issues.data?.issues.find((issue) => issue.id === reviewId)?.title;
  const label = title || reviewId;
  return (
    <p
      data-testid="outline-review-draft-note"
      className="border-b border-border px-4 py-3 text-sm text-muted-foreground"
    >
      Outline body saves are held for an open draft from{" "}
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
