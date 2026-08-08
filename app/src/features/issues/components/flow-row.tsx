import type { ReactNode } from "react";
import { OverviewRow } from "@/components/ui/overview-row";
import { StateIcon } from "@/components/ui/rail";
import { hasAttention } from "@server/kind";
import type { IssueRecord } from "@server/schemas";
import { leafTaskProgressCount, isInFlight } from "../lib/derived";
import type { FlowItem } from "../lib/flow";
import { issueRailNodeState } from "../lib/rail-state";

export interface FlowRowProps {
  item: FlowItem;
  issues: IssueRecord[];
  avatar?: ReactNode;
  actions?: ReactNode;
  touchMenu?: ReactNode;
  /** When set, the full row drills in here; actions stay outside the link. */
  to?: string;
}

/**
 * Flow surface row: title, state icon, tabular task count, avatar, and icon-only signals.
 * Steering actions overlay the row on hover/focus or via a flat touch overflow menu.
 */
export function FlowRow({
  item,
  issues,
  avatar,
  actions,
  touchMenu,
  to,
}: FlowRowProps) {
  const attention = hasAttention(item.issue) && item.issue.needsAttention;
  const railState = issueRailNodeState(item.issue, item.state);
  const live = isInFlight(item.issue, item.state);
  const count = leafTaskProgressCount(item.issue, issues);

  return (
    <OverviewRow
      className="min-w-0 flex-1"
      avatar={avatar}
      stateIcon={<StateIcon state={railState} live={live} />}
      attention={attention}
      blocked={Boolean(item.state?.blocked)}
      count={count}
      overlay={actions}
      touchMenu={touchMenu}
      drillInTo={to}
      drillInLabel={item.issue.title}
    >
      {item.issue.title}
    </OverviewRow>
  );
}
