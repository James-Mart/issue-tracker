import { useMemo } from "react";
import type { IssueDetail } from "@server/schemas";
import { useIssuesQuery } from "../api/queries";
import {
  StoryGitMetaScalars,
  TaskGitMetaScalars,
} from "./issue-git-meta-scalars";

/** Git/spec scalar rows for story/task detail (fragment; no card chrome). */
export function GitStackPanel({ issue }: { issue: IssueDetail }) {
  const { data } = useIssuesQuery();
  const issues = useMemo(() => data?.issues ?? [], [data?.issues]);
  if (!data) return null;
  if (issue.kind === "story") {
    const state = data.derived[issue.id];
    return <StoryGitMetaScalars issue={issue} mergeBase={state?.mergeBase} />;
  }
  if (issue.kind === "task") {
    return <TaskGitMetaScalars issue={issue} issues={issues} />;
  }
  return null;
}
