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
    if (!storyAxesVisible(state?.storyStatus, issue.specReview, issue.retro)) {
      return null;
    }
    return (
      <StoryAxisChips
        storyStatus={state?.storyStatus}
        specReview={issue.specReview}
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
