import { useNavigate } from "react-router-dom";
import { reviewIssuePath } from "../lib/links";

/** Open a review issue in this tab, or a new tab when `newTab` is set. */
export function useGoToReviewIssue(projectId: string) {
  const navigate = useNavigate();
  return (reviewId: string, newTab = false) => {
    const path = reviewIssuePath(projectId, reviewId);
    if (newTab) {
      window.open(path, "_blank", "noopener");
      return;
    }
    navigate(path);
  };
}
