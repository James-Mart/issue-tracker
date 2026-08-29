import type { ReactNode } from "react";
import { OverviewRow } from "@/components/ui/overview-row";
import { ProgressSparkline } from "@/components/ui/progress-sparkline";
import { RailNode } from "@/components/ui/rail";
import type { IssueRecord } from "@server/schemas";
import { leafTaskProgressCount } from "../lib/derived";
import type { FlowItem } from "../lib/flow";
import { flowItemNeedsAttention } from "../lib/flow";
import { flowItemSparkline } from "../lib/flow-sparkline";
import { issueRailNodeState } from "../lib/rail-state";

export interface FlowRowProps {
  item: FlowItem;
  issues: IssueRecord[];
  avatar?: ReactNode;
  actions?: ReactNode;
  /** When set, the full row drills in here; actions stay outside the link. */
  to?: string;
}

/**
 * Cockpit flow row: one horizontal line, state disc on the bucket rail spine,
 * demand icon on Needs attention, sparkline on moving work, icon-only actions.
 */
export function FlowRow({
  item,
  issues,
  avatar,
  actions,
  to,
}: FlowRowProps) {
  const railState = issueRailNodeState(item.issue, item.state);
  const live = railState === "in-flight";
  const count = leafTaskProgressCount(item.issue, issues);
  const stages = flowItemSparkline(item);

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
        sparkline={
          stages ? <ProgressSparkline stages={stages} /> : undefined
        }
        blocked={Boolean(item.state?.blocked)}
        attention={flowItemNeedsAttention(item)}
        count={count}
        actions={actions}
        drillInTo={to}
        drillInLabel={item.issue.title}
      >
        {item.issue.title}
      </OverviewRow>
    </RailNode>
  );
}
