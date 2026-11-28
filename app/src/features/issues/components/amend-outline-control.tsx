import { useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useIssueDetailQuery } from "../api/queries";
import {
  type IssueBackLocationState,
  issueBackNavigateState,
} from "../lib/issue-back";
import { issueChannelPath } from "../lib/links";
import { NewPlanningSessionDialog } from "./outline-new-planning-session";

function amendOutlineStatus(
  detail: ReturnType<typeof useIssueDetailQuery>,
  outlineId: string,
): string {
  if (detail.error) return detail.error.message;
  if (detail.data && detail.data.kind !== "outline") {
    return `Issue ${outlineId} is not an outline.`;
  }
  return "Loading outline…";
}

/**
 * Amend outline on an open Story. The caller renders the trigger. The dialog
 * is the new-planning-session brief, started with this Story as `researchStory`.
 */
export function AmendOutlineControl({
  projectId,
  storyId,
  outlineId,
  trigger,
}: {
  projectId: string;
  storyId: string;
  outlineId: string;
  trigger: (openDialog: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const detail = useIssueDetailQuery(outlineId, { enabled: open });
  const navigate = useNavigate();
  const location = useLocation();
  const outline = detail.data?.kind === "outline" ? detail.data : undefined;

  const goToSession = () => {
    const navigateState = issueBackNavigateState(
      location.pathname,
      location.search,
      (location.state as IssueBackLocationState | null)?.issueBackStack,
    );
    navigate(
      issueChannelPath(projectId, outlineId, "planning"),
      navigateState ? { state: navigateState } : undefined,
    );
  };

  return (
    <>
      {trigger(() => setOpen(true))}
      <NewPlanningSessionDialog
        outlineId={outlineId}
        bodyVersion={outline?.bodyVersion}
        unavailable={amendOutlineStatus(detail, outlineId)}
        open={open}
        researchStory={storyId}
        onOpenChange={setOpen}
        onStarted={goToSession}
      />
    </>
  );
}
