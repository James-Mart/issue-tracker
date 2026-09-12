import { GitPullRequest } from "lucide-react";
import type { DerivedState, IssueRecord } from "@server/schemas";
import { Button } from "@/components/ui/button";
import type { FlowItem } from "../lib/flow";
import { isCapturedIdeaFlowItem, isReadyWorkFlowItem } from "../lib/flow";
import { ImplementingFlowRowLaunch } from "./implementing-launch-control";
import { PlanningFlowRowLaunch } from "./planning-launch-control";

/** Inline cockpit row actions scoped to what each flow bucket can perform. */
export function FlowRowActions({
  item,
  issues = [],
  derived = {},
}: {
  item: FlowItem;
  issues?: IssueRecord[];
  derived?: Record<string, DerivedState>;
}) {
  const prUrl =
    item.issue.kind === "story" ? item.issue.prUrl : undefined;
  const capturedIdea = isCapturedIdeaFlowItem(item) ? item.issue : undefined;
  const readyWork = isReadyWorkFlowItem(item, issues, derived)
    ? item.issue
    : undefined;

  return (
    <>
      {capturedIdea ? <PlanningFlowRowLaunch issue={capturedIdea} /> : null}
      {readyWork ? <ImplementingFlowRowLaunch issue={readyWork} /> : null}
      {prUrl ? (
        <Button asChild variant="default" size="icon-sm">
          <a
            href={prUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Open PR"
            title="Open PR"
          >
            <GitPullRequest className="h-3.5 w-3.5" />
          </a>
        </Button>
      ) : null}
    </>
  );
}
