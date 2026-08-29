import { GitPullRequest } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FlowItem } from "../lib/flow";
import { isCapturedIdeaFlowItem, isReadyWorkFlowItem } from "../lib/flow";
import type { ImplementingLockRefusal } from "../lib/implementing-launch";
import { ImplementingFlowRowLaunch } from "./implementing-launch-control";
import { PlanningFlowRowLaunch } from "./planning-launch-control";

/** Inline cockpit row actions scoped to what each flow bucket can perform. */
export function FlowRowActions({
  item,
  onImplementingLockRefusal,
}: {
  item: FlowItem;
  onImplementingLockRefusal?: (refusal: ImplementingLockRefusal) => void;
}) {
  const prUrl =
    item.issue.kind === "story" ? item.issue.prUrl : undefined;
  const capturedIdea = isCapturedIdeaFlowItem(item) ? item.issue : undefined;
  const readyWork = isReadyWorkFlowItem(item) ? item.issue : undefined;

  return (
    <>
      {capturedIdea ? <PlanningFlowRowLaunch issue={capturedIdea} /> : null}
      {readyWork && onImplementingLockRefusal ? (
        <ImplementingFlowRowLaunch
          issue={readyWork}
          onLockRefusal={onImplementingLockRefusal}
        />
      ) : null}
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
