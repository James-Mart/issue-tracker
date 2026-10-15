import { useCallback } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  reviewRunIdFromSearch,
  reviewRunReturnFromState,
  reviewRunWasOpened,
  searchClosingReviewRun,
  searchOpeningReviewRun,
  searchWithoutReviewRun,
  type ReviewRunReturn,
} from "../lib/review-run-search";

/** Open and close the review-run transcript in the workbench search params. */
export function useReviewRunSearch() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const runId = reviewRunIdFromSearch(searchParams);

  const openRun = useCallback(
    (
      conversationId: string,
      options?: { tab?: string; returnTo?: ReviewRunReturn },
    ) => {
      setSearchParams((prev) => searchOpeningReviewRun(prev, conversationId, options), {
        state: {
          reviewRunOpened: true,
          ...(options?.returnTo ? { reviewRunReturn: options.returnTo } : {}),
        },
      });
    },
    [setSearchParams],
  );

  const closeRun = useCallback(() => {
    const returnTo = reviewRunReturnFromState(location.state);
    if (returnTo) {
      setSearchParams((prev) => searchClosingReviewRun(prev, returnTo), { replace: true });
      return;
    }
    if (reviewRunWasOpened(location.state)) {
      navigate(-1);
      return;
    }
    setSearchParams((prev) => searchWithoutReviewRun(prev), { replace: true });
  }, [location.state, navigate, setSearchParams]);

  return { runId, openRun, closeRun };
}
