import { useCallback, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ALL_CHANGES_SCOPE,
  resolveReviewScope,
  writeReviewWorkbenchSearch,
} from "../lib/review-scope";
import {
  resolveReviewWorkbenchTab,
  type ReviewWorkbenchTab,
} from "../lib/workbench-tabs";

/**
 * Active tab (`?tab=`) and review scope (`?scope=`). A missing or unknown tab
 * is rewritten to the resolved tab. Scope rewrites once the Story's commit
 * shas are known.
 */
export function useReviewWorkbenchLocation(knownShas: readonly string[] | undefined): {
  active: ReviewWorkbenchTab;
  setTab: (tab: ReviewWorkbenchTab) => void;
  scope: string;
  setScope: (scope: string) => void;
} {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get("tab");
  const rawScope = searchParams.get("scope");
  const active = resolveReviewWorkbenchTab(rawTab);
  const scope = resolveReviewScope(rawScope, knownShas);

  const write = useCallback(
    (tab: ReviewWorkbenchTab, nextScope: string) =>
      setSearchParams(
        (prev) => writeReviewWorkbenchSearch(prev, tab, nextScope),
        { replace: true },
      ),
    [setSearchParams],
  );

  const setTab = useCallback(
    (tab: ReviewWorkbenchTab) => write(tab, scope),
    [scope, write],
  );
  const setScope = useCallback(
    (nextScope: string) => write(active, nextScope),
    [active, write],
  );

  const waitingForCommits =
    knownShas === undefined &&
    rawScope !== null &&
    rawScope.length > 0 &&
    rawScope !== ALL_CHANGES_SCOPE;

  useEffect(() => {
    if (waitingForCommits) {
      if (rawTab !== active) write(active, scope);
      return;
    }
    if (rawTab !== active || rawScope !== scope) write(active, scope);
  }, [active, rawScope, rawTab, scope, waitingForCommits, write]);

  return { active, setTab, scope, setScope };
}
