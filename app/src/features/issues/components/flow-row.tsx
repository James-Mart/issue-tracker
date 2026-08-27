import type { ReactNode } from "react";
import { OverviewRow } from "@/components/ui/overview-row";
import { StateIcon } from "@/components/ui/rail";
import type { IssueRecord } from "@server/schemas";
import { leafTaskProgressCount, isInFlight } from "../lib/derived";
import type { FlowItem } from "../lib/flow";
import { issueRailNodeState } from "../lib/rail-state";
import { AxisChips } from "./axis-chips";

export interface FlowRowProps {
  item: FlowItem;
  issues: IssueRecord[];
  avatar?: ReactNode;
  actions?: ReactNode;
  /** When set, the full row drills in here; actions stay outside the link. */
  to?: string;
}

/**
 * Flow surface row: title, state icon, tabular task count, avatar, and icon-only signals.
 * Steering actions render inline in the row flex line when provided.
 */
export function FlowRow({
  item,
  issues,
  avatar,
  actions,
  to,
}: FlowRowProps) {
  const railState = issueRailNodeState(item.issue, item.state);
  const live = isInFlight(item.issue, item.state);
  const count = leafTaskProgressCount(item.issue, issues);

  return (
    <OverviewRow
      className="min-w-0 flex-1"
      avatar={avatar}
      stateIcon={<StateIcon state={railState} live={live} />}
      chips={
        item.issue.kind === "idea" &&
        (item.state?.ideaStatus === "planning" ||
          item.state?.ideaStatus === "awaiting-direction") ? (
          <AxisChips chips={[{ variant: "inProgress", label: "planning" }]} />
        ) : undefined
      }
      blocked={Boolean(item.state?.blocked)}
      count={count}
      actions={actions}
      drillInTo={to}
      drillInLabel={item.issue.title}
    >
      {item.issue.title}
    </OverviewRow>
  );
}
