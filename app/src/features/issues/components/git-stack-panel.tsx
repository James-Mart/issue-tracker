import { useMemo } from "react";
import { useParams } from "react-router-dom";
import type { IssueDetail } from "@server/schemas";
import { useIssuesQuery } from "../api/queries";
import {
  StoryGitMetaScalars,
  TaskGitMetaScalars,
} from "./issue-git-meta-scalars";
import { PrStatusPanel } from "./pr-status-panel";

/** Git/spec scalar rows for story/task detail (fragment; no card chrome). */
export function GitStackPanel({ issue }: { issue: IssueDetail }) {
  const { projectId = "" } = useParams();
  const { data } = useIssuesQuery();
  const issues = useMemo(() => data?.issues ?? [], [data?.issues]);
  if (!data) return null;
  if (issue.kind === "story") {
    const state = data.derived[issue.id];
    return (
      <>
        <StoryGitMetaScalars issue={issue} mergeBase={state?.mergeBase} />
        {issue.prUrl ? (
          <PrStatusPanel
            story={{ ...issue, prUrl: issue.prUrl }}
            projectId={projectId}
          />
        ) : null}
      </>
    );
  }
  if (issue.kind === "task") {
    return <TaskGitMetaScalars issue={issue} issues={issues} />;
  }
  return null;
}
