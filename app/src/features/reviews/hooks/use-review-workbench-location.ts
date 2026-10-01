import { useCallback, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import type { CommentThread } from "@/features/issues/lib/comment-threads";
import { readDiffThreadSearchParam } from "@/features/issues/lib/issue-detail-tabs";
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
 * Active tab (`?tab=`), review scope (`?scope=`), and the Diff thread to
 * open (`?thread=`). A missing or unknown tab is rewritten to the resolved
 * tab. Scope rewrites once the Story's commit shas are known.
 */
export function useReviewWorkbenchLocation(knownShas: readonly string[] | undefined): {
  active: ReviewWorkbenchTab;
  setTab: (tab: ReviewWorkbenchTab) => void;
  scope: string;
  setScope: (scope: string) => void;
  threadId: string | null;
  openThreadInDiff: (threadId: string, commitSha: string) => void;
  openThreadInConversation: (threadId: string) => void;
  openThread: (thread: CommentThread) => void;
  /** Move scope without dropping the Diff thread the workbench is opening. */
  retargetThreadScope: (scope: string) => void;
} {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get("tab");
  const rawScope = searchParams.get("scope");
  const active = resolveReviewWorkbenchTab(rawTab);
  const scope = resolveReviewScope(rawScope, knownShas);
  const threadId = readDiffThreadSearchParam(searchParams);

  const write = useCallback(
    (
      tab: ReviewWorkbenchTab,
      nextScope: string,
      nextThreadId?: string | null,
    ) =>
      setSearchParams(
        (prev) => writeReviewWorkbenchSearch(prev, tab, nextScope, nextThreadId),
        { replace: true },
      ),
    [setSearchParams],
  );

  const setTab = useCallback(
    (tab: ReviewWorkbenchTab) => write(tab, scope, null),
    [scope, write],
  );
  const setScope = useCallback(
    (nextScope: string) => write(active, nextScope, null),
    [active, write],
  );
  const openThreadInConversation = useCallback(
    (nextThreadId: string) => write("conversation", scope, nextThreadId),
    [scope, write],
  );
  const openThreadInDiff = useCallback(
    (nextThreadId: string, commitSha: string) => {
      // A missing or stale anchor commit is not in this review's commit list.
      // Widen to All changes so the thread still opens, matching resolveReviewScope.
      const nextScope =
        knownShas === undefined
          ? commitSha
          : knownShas.includes(commitSha)
            ? commitSha
            : ALL_CHANGES_SCOPE;
      write("diff", nextScope, nextThreadId);
    },
    [knownShas, write],
  );
  const openThread = useCallback(
    (thread: CommentThread) => {
      const anchor = thread.root.anchor;
      if (anchor) openThreadInDiff(thread.root.id, anchor.commitSha);
      else openThreadInConversation(thread.root.id);
    },
    [openThreadInConversation, openThreadInDiff],
  );
  const retargetThreadScope = useCallback(
    (nextScope: string) => {
      if (!threadId) return;
      write("diff", nextScope, threadId);
    },
    [threadId, write],
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

  return {
    active,
    setTab,
    scope,
    setScope,
    threadId,
    openThreadInDiff,
    openThreadInConversation,
    openThread,
    retargetThreadScope,
  };
}
