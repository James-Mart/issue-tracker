import { useCallback, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import {
  resolveReviewWorkbenchTab,
  type ReviewWorkbenchTab,
} from "../lib/workbench-tabs";

/** Active workbench tab from `?tab=`; a missing or unknown value is rewritten to the resolved tab. */
export function useReviewWorkbenchTab(): {
  active: ReviewWorkbenchTab;
  setTab: (tab: ReviewWorkbenchTab) => void;
} {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get("tab");
  const active = resolveReviewWorkbenchTab(rawTab);
  const setTab = useCallback(
    (tab: ReviewWorkbenchTab) =>
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("tab", tab);
          return next;
        },
        { replace: true },
      ),
    [setSearchParams],
  );

  useEffect(() => {
    if (rawTab !== active) setTab(active);
  }, [active, rawTab, setTab]);

  return { active, setTab };
}
