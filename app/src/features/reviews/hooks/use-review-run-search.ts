import { useCallback } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  reviewRunIdFromSearch,
  reviewRunWasOpened,
  searchWithReviewRun,
  searchWithoutReviewRun,
} from "../lib/review-run-search";

/** Open and close the review-run transcript in the workbench search params. */
export function useReviewRunSearch() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const runId = reviewRunIdFromSearch(searchParams);

  const openRun = useCallback(
    (conversationId: string) => {
      setSearchParams((prev) => searchWithReviewRun(prev, conversationId), {
        state: { reviewRunOpened: true },
      });
    },
    [setSearchParams],
  );

  const closeRun = useCallback(() => {
    if (reviewRunWasOpened(location.state)) {
      navigate(-1);
      return;
    }
    setSearchParams((prev) => searchWithoutReviewRun(prev), { replace: true });
  }, [location.state, navigate, setSearchParams]);

  return { runId, openRun, closeRun };
}
