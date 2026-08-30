import type { ReactNode } from "react";
import { OverviewRow } from "@/components/ui/overview-row";
import { RailNode } from "@/components/ui/rail";
import type { IssueRecord } from "@server/schemas";
import { AxisChips } from "./axis-chips";
import { leafTaskProgressCount } from "../lib/derived";
import type { FlowItem } from "../lib/flow";
import { flowItemNeedsAttention } from "../lib/flow";
import { issueRailNodeState } from "../lib/rail-state";

function flowRowPlanningBadge(item: FlowItem): ReactNode | undefined {
  if (item.issue.kind !== "idea") return undefined;
  const status = item.state?.ideaStatus;
  if (status !== "planning" && status !== "awaiting-direction") {
    return undefined;
  }
  return (
    <AxisChips chips={[{ variant: "inProgress", label: "planning" }]} />
  );
}

export interface FlowRowProps {
  item: FlowItem;
  issues: IssueRecord[];
  avatar?: ReactNode;
  actions?: ReactNode;
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
  to,
  drillInState,
}: FlowRowProps) {
  const railState = issueRailNodeState(item.issue, item.state);
  const live = railState === "in-flight";
  const count = leafTaskProgressCount(item.issue, issues);

  return (
    <RailNode
      state={railState}
      edge={item.state?.blocked ? "dashed" : "solid"}
      glow={live}
      className="items-center py-1"
    >
      <OverviewRow
        className="min-w-0 flex-1"
        avatar={avatar}
        chips={flowRowPlanningBadge(item)}
        blocked={Boolean(item.state?.blocked)}
        attention={flowItemNeedsAttention(item)}
        count={count}
        actions={actions}
        drillInTo={to}
        drillInState={drillInState}
        drillInLabel={item.issue.title}
      >
        {item.issue.title}
      </OverviewRow>
    </RailNode>
  );
}
