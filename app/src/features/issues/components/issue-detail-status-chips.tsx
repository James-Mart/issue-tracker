import type { IssueDetail } from "@server/schemas";
import { useIssuesQuery } from "../api/queries";
import {
  cockpitLaunchOverlayForIssue,
  overlayCockpitLaunchAck,
} from "../lib/cockpit-launch-sync";
import { useCockpitLaunchStore } from "../store/use-cockpit-launch-store";
import {
  AxisChips,
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
  const pending = useCockpitLaunchStore((s) => s.pending);
  const ack = useCockpitLaunchStore((s) => s.ack);
  const overlay = cockpitLaunchOverlayForIssue(issue.id, pending, ack);
  const derived = overlay
    ? overlayCockpitLaunchAck(
        data?.derived ?? {},
        data?.issues ?? [],
        overlay,
      )
    : data?.derived;

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

  if (issue.kind === "idea") {
    const state = derived?.[issue.id];
    const status = state?.ideaStatus;
    if (status === "awaiting-approval") {
      return (
        <AxisChips
          chips={[{ variant: "warn", label: "awaiting approval" }]}
          className={className}
        />
      );
    }
    if (status !== "planning" && status !== "awaiting-direction") {
      return null;
    }
    return (
      <AxisChips
        chips={[{ variant: "inProgress", label: "planning" }]}
        className={className}
      />
    );
  }

  return null;
}
