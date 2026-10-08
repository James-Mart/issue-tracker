import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { isArchived } from "@server/services/archived-visibility";
import type { IssueDetail } from "@server/schemas";
import { StoryCodeReviewRow } from "@/features/reviews/components/story-code-review-row";
import { useIssuesWithArchived } from "../hooks/use-issues-with-archived";
import {
  IssueLinkResolution,
  useSupplementedById,
} from "../hooks/use-supplemented-by-id";
import {
  StoryGitMetaScalars,
  TaskGitMetaScalars,
} from "./issue-git-meta-scalars";
import { PrStatusPanel } from "./pr-status-panel";

/** Git/spec scalar rows for story/task detail (fragment; no card chrome). */
export function GitStackPanel({ issue }: { issue: IssueDetail }) {
  const { projectId = "" } = useParams();
  const { data } = useIssuesWithArchived(isArchived(issue));
  const chainIds =
    issue.kind === "task"
      ? [issue.partOf]
      : issue.kind === "story" && issue.stackedOn
        ? [issue.stackedOn]
        : [];
  const { byId, missingIds, accept, reject } = useSupplementedById(
    chainIds,
    issue,
  );
  const issues = useMemo(() => [...byId.values()], [byId]);
  if (!data) return null;
  const resolution = (
    <IssueLinkResolution
      missingIds={missingIds}
      accept={accept}
      reject={reject}
    />
  );
  if (issue.kind === "story") {
    const state = data.derived[issue.id];
    return (
      <>
        {resolution}
        <StoryGitMetaScalars
          issue={issue}
          mergeBase={state?.mergeBase}
          beforeStackedOn={
            <StoryCodeReviewRow projectId={projectId} story={issue} />
          }
        />
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
    return (
      <>
        {resolution}
        <TaskGitMetaScalars issue={issue} issues={issues} />
      </>
    );
  }
  return null;
}
