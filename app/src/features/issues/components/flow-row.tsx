import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { hasAttention } from "@server/kind";
import type { IssueRecord } from "@server/schemas";
import { OverviewRow } from "@/components/ui/overview-row";
import { StateIcon } from "@/components/ui/rail";
import { cn } from "@/lib/utils/cn";
import { leafTaskProgressCount } from "../lib/derived";
import type { FlowItem } from "../lib/flow";
import { issueRailNodeState } from "../lib/rail-state";

export interface FlowRowProps {
  item: FlowItem;
  issues: IssueRecord[];
  avatar?: ReactNode;
  actions?: ReactNode;
  /** When set, the row body links here; actions stay outside the link. */
  to?: string;
}

/**
 * Flow surface row: title, state icon, tabular task count, avatar, and icon-only signals.
 * Steering actions reveal on row hover or focus.
 */
export function FlowRow({ item, issues, avatar, actions, to }: FlowRowProps) {
  const attention = hasAttention(item.issue) && item.issue.needsAttention;
  const railState = issueRailNodeState(item.issue, item.state);
  const count = leafTaskProgressCount(item.issue, issues);

  const body = (
    <OverviewRow
      className={to ? undefined : "min-w-0 flex-1"}
      avatar={avatar}
      stateIcon={<StateIcon state={railState} />}
      attention={attention}
      blocked={Boolean(item.state?.blocked)}
      count={count}
    >
      {item.issue.title}
    </OverviewRow>
  );

  return (
    <div className="group flex min-w-0 items-center gap-1.5">
      {to != null ? (
        <Link
          to={to}
          className="min-w-0 flex-1 text-inherit no-underline hover:no-underline"
        >
          {body}
        </Link>
      ) : (
        body
      )}
      {actions != null ? (
        <span
          className={cn(
            "flex shrink-0 items-center gap-0.5",
            "opacity-0 transition-opacity",
            "group-hover:opacity-100 group-focus-within:opacity-100",
            "focus-within:opacity-100",
          )}
        >
          {actions}
        </span>
      ) : null}
    </div>
  );
}
