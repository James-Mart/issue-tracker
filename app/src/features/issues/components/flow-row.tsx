import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { hasAttention } from "@server/kind";
import { OverviewRow } from "@/components/ui/overview-row";
import { ProgressRail } from "@/components/ui/rail";
import { cn } from "@/lib/utils/cn";
import type { FlowItem } from "../lib/flow";

export interface FlowRowProps {
  item: FlowItem;
  avatar?: ReactNode;
  actions?: ReactNode;
  /** When set, the row body links here; actions stay outside the link. */
  to?: string;
}

/**
 * Flow surface row: title, lifecycle sparkline, avatar, and icon-only signals.
 * Steering actions reveal on row hover or focus.
 */
export function FlowRow({ item, avatar, actions, to }: FlowRowProps) {
  const attention = hasAttention(item.issue) && item.issue.needsAttention;

  const body = (
    <OverviewRow
      className={to ? undefined : "min-w-0 flex-1"}
      avatar={avatar}
      sparkline={<ProgressRail issue={item.issue} state={item.state} />}
      attention={attention}
      blocked={Boolean(item.state?.blocked)}
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
