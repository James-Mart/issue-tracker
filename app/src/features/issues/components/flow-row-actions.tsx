import { GitPullRequest } from "lucide-react";
import type { IssueRecord } from "@server/schemas";
import { Button } from "@/components/ui/button";
import { useProjectPullRequestsQuery } from "../api/queries";
import type { FlowItem } from "../lib/flow";
import { isCapturedIdeaFlowItem } from "../lib/flow";
import { PlanningFlowRowLaunch } from "./planning-launch-control";
import { PrChip, storyPrChipModel } from "./pr-chip";

function useFlowRowPrChip(issue: IssueRecord, projectId: string) {
  const prQuery = useProjectPullRequestsQuery(projectId);
  return storyPrChipModel(issue, prQuery);
}

/** Inline cockpit row actions scoped to what each flow bucket can perform. */
export function FlowRowActions({
  item,
  projectId,
}: {
  item: FlowItem;
  projectId: string;
}) {
  const prChip = useFlowRowPrChip(item.issue, projectId);
  const prUrl =
    item.issue.kind === "story" ? item.issue.prUrl : undefined;
  const capturedIdea = isCapturedIdeaFlowItem(item) ? item.issue : undefined;

  return (
    <>
      {capturedIdea ? <PlanningFlowRowLaunch issue={capturedIdea} /> : null}
      {prUrl ? (
        <>
          <Button asChild variant="default" size="sm">
            <a href={prUrl} target="_blank" rel="noreferrer">
              <GitPullRequest className="h-3.5 w-3.5" />
              Open PR
            </a>
          </Button>
          <PrChip model={prChip} />
        </>
      ) : null}
    </>
  );
}
