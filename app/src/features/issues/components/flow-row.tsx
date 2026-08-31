import type { ReactNode } from "react";
import { OverviewRow } from "@/components/ui/overview-row";
import { RailNode } from "@/components/ui/rail";
import type { IssueRecord } from "@server/schemas";
import { AxisChips } from "./axis-chips";
import { leafTaskProgressCount } from "../lib/derived";
import { issuesById, projectIdOf } from "../lib/build-tree";
import type { FlowItem } from "../lib/flow";
import { flowItemNeedsAttention } from "../lib/flow";
import { issueChannelPath } from "../lib/links";
import { issueRailNodeState } from "../lib/rail-state";

function flowRowPlanningBadge(item: FlowItem): ReactNode | undefined {
  if (item.issue.kind !== "idea") return undefined;
  const status = item.state?.ideaStatus;
  if (status === "awaiting-approval") {
    return (
      <AxisChips chips={[{ variant: "warn", label: "awaiting approval" }]} />
    );
  }
  if (status !== "planning" && status !== "awaiting-direction") {
    return undefined;
  }
  return (
    <AxisChips chips={[{ variant: "inProgress", label: "planning" }]} />
  );
}

function flowRowDrillInTo(
  item: FlowItem,
  issues: IssueRecord[],
  to: string | undefined,
): string | undefined {
  if (to == null) return undefined;
  if (
    item.issue.kind === "idea" &&
    item.state?.ideaStatus === "awaiting-approval"
  ) {
    const projectId = projectIdOf(item.issue.id, issuesById(issues));
    if (projectId) {
      return issueChannelPath(projectId, item.issue.id, "planning");
    }
  }
  return to;
}

function flowRowShowsAttentionTriangle(item: FlowItem): boolean {
  if (
    item.issue.kind === "idea" &&
    item.state?.ideaStatus === "awaiting-approval"
  ) {
    return false;
  }
  return flowItemNeedsAttention(item);
}

export interface FlowRowProps {
  item: FlowItem;
  issues: IssueRecord[];
  avatar?: ReactNode;
  actions?: ReactNode;
  /** Row-attached launch fault; retry is the restored Play control. */
  launchFault?: string;
  /** When set, the full row drills in here; actions stay outside the link. */
  to?: string;
  drillInState?: unknown;
}

/**
 * Cockpit flow row: one horizontal line, state disc on the bucket rail spine,
 * planning badge on directed Ideas, demand icon on Needs attention, icon-only actions.
 */
export function FlowRow({
  item,
  issues,
  avatar,
  actions,
  launchFault,
  to,
  drillInState,
}: FlowRowProps) {
  const railState = issueRailNodeState(item.issue, item.state);
  const live = railState === "in-flight";
  const count = leafTaskProgressCount(item.issue, issues);
  const drillInTo = flowRowDrillInTo(item, issues, to);

  return (
    <RailNode
      state={railState}
      edge={item.state?.blocked ? "dashed" : "solid"}
      glow={live}
      className="items-center py-1"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <OverviewRow
          className="min-w-0"
          avatar={avatar}
          chips={flowRowPlanningBadge(item)}
          blocked={Boolean(item.state?.blocked)}
          attention={flowRowShowsAttentionTriangle(item)}
          count={count}
          actions={actions}
          drillInTo={drillInTo}
          drillInState={drillInState}
          drillInLabel={item.issue.title}
        >
          {item.issue.title}
        </OverviewRow>
        {launchFault ? (
          <p
            role="alert"
            data-testid="flow-row-launch-fault"
            className="rounded-md border border-[hsl(var(--blocked))]/35 bg-[hsl(var(--blocked))]/10 px-2.5 py-1.5 font-mono text-[11px] leading-snug text-[hsl(var(--blocked))]"
          >
            {launchFault}
          </p>
        ) : null}
      </div>
    </RailNode>
  );
}
