import { useMemo } from "react";
import { useIssuesQuery } from "../api/queries";
import { mergeLiveWithArchivedOnly } from "../lib/archived-issue-list";

/**
 * Default issue list (`GET /api/issues`), switching to
 * `GET /api/issues?archived=include` once that read arrives.
 */
export function useIssuesIncludingArchived(includeArchived: boolean) {
  const live = useIssuesQuery();
  const flagged = useIssuesQuery(includeArchived ? "include" : undefined);
  const data = includeArchived && flagged.data ? flagged.data : live.data;
  return { ...live, data };
}

/**
 * Live issue list, plus archived issues from `GET /api/issues?archived=only`
 * when `includeArchived` is set. Archived rows are not taken from the default
 * list once that flagged read has arrived.
 */
export function useIssuesWithArchived(includeArchived: boolean) {
  const live = useIssuesQuery();
  const archived = useIssuesQuery(includeArchived ? "only" : undefined);
  const data = useMemo(() => {
    if (!includeArchived || !live.data || !archived.data) return live.data;
    // The flagged read is a different payload. A shared issues array means
    // there is no separate archived list to merge.
    if (live.data.issues === archived.data.issues) return live.data;
    return mergeLiveWithArchivedOnly(live.data, archived.data);
  }, [includeArchived, live.data, archived.data]);
  return { ...live, data };
}
