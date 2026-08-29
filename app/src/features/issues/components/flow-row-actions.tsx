import { GitPullRequest } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FlowItem } from "../lib/flow";
import { isCapturedIdeaFlowItem } from "../lib/flow";
import { PlanningFlowRowLaunch } from "./planning-launch-control";

/** Inline cockpit row actions scoped to what each flow bucket can perform. */
export function FlowRowActions({ item }: { item: FlowItem }) {
  const prUrl =
    item.issue.kind === "story" ? item.issue.prUrl : undefined;
  const capturedIdea = isCapturedIdeaFlowItem(item) ? item.issue : undefined;

  return (
    <>
      {capturedIdea ? <PlanningFlowRowLaunch issue={capturedIdea} /> : null}
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
