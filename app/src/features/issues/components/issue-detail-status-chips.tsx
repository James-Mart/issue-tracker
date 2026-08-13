import type { IssueDetail } from "@server/schemas";
import { useIssuesQuery } from "../api/queries";
import {
  EpicAxisChips,
  StoryAxisChips,
  epicAxesVisible,
  storyAxesVisible,
} from "./axis-chips";
import { TaskStatusChips } from "./task-status-chips";

/** Kind-dispatched Foundations status chips for the detail header. */
export function IssueDetailStatusChips({
  issue,
  className,
}: {
  issue: IssueDetail;
  className?: string;
}) {
  const { data } = useIssuesQuery();
  const derived = data?.derived;

  if (issue.kind === "task") {
    return (
      <TaskStatusChips
        status={issue.status}
        qa={issue.qa}
        className={className}
      />
    );
  }

  if (issue.kind === "story") {
    const state = derived?.[issue.id];
    const reviewStale = Boolean(issue.review && state?.reviewCurrent === false);
    if (!storyAxesVisible(state?.storyStatus, issue.review, issue.retro, issue.needsRebase, reviewStale)) {
      return null;
    }
    return (
      <StoryAxisChips
        storyStatus={state?.storyStatus}
        review={issue.review}
        reviewStale={reviewStale}
        needsRebase={issue.needsRebase}
        retro={issue.retro}
        className={className}
      />
    );
  }

  if (issue.kind === "epic") {
    const state = derived?.[issue.id];
    if (!epicAxesVisible(state?.epicStatus, issue.retro)) {
      return null;
    }
    return (
      <EpicAxisChips
        epicStatus={state?.epicStatus}
        retro={issue.retro}
        className={className}
      />
    );
  }

  return null;
}
