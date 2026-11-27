import { useMemo } from "react";
import { useIssuesQuery } from "../api/queries";
import { issuesById } from "../lib/build-tree";

/** Catalog title for an issue id, or the id when that row has no title yet. */
export function useIssueTitle(id: string): string {
  const issues = useIssuesQuery();
  const byId = useMemo(
    () => issuesById(issues.data?.issues ?? []),
    [issues.data?.issues],
  );
  return byId.get(id)?.title || id;
}
