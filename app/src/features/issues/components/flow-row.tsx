import type { ReactNode } from "react";
import { AlertCircle, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { RailNode } from "@/components/ui/rail";
import { cn } from "@/lib/utils/cn";
import { AxisChips } from "./axis-chips";
import { PlanningFlowRowGates } from "./planning-launch-control";
import { isReadyToLandFromIndexes, leafTaskProgressCount } from "../lib/derived";
import { projectIdOf } from "../lib/build-tree";
import type { FlowItem } from "../lib/flow";
import type { TreeRowIndexes } from "../lib/tree-row-indexes";
import {
  flowItemNeedsAttention,
  isCapturedIdeaFlowItem,
  isWorkQueuedRoot,
} from "../lib/flow";
import { issueChannelPath } from "../lib/links";
import { issueRailNodeState } from "../lib/rail-state";

function flowRowStatusChips(
  item: FlowItem,
  indexes: TreeRowIndexes,
): ReactNode | undefined {
  const chips: Array<{ variant: "todo" | "warn" | "inProgress"; label: string }> =
    [];

  if (item.issue.kind === "story") {
    if (
      !item.issue.prUrl &&
      isReadyToLandFromIndexes(item.issue, item.state, indexes)
    ) {
      chips.push({ variant: "todo", label: "awaiting PR" });
    }
  } else if (item.issue.kind === "idea") {
    const status = item.state?.ideaStatus;
    if (status === "awaiting-approval") {
      chips.push({ variant: "warn", label: "awaiting approval" });
    } else if (status === "planning" || status === "awaiting-direction") {
      chips.push({ variant: "inProgress", label: "planning" });
    }
  }

  if (isWorkQueuedRoot(item.issue)) {
    chips.push({ variant: "todo", label: "Queued" });
  }

  if (chips.length === 0) return undefined;
  return <AxisChips chips={chips} />;
}

function flowRowDrillInTo(
  item: FlowItem,
  indexes: TreeRowIndexes,
  to: string | undefined,
): string | undefined {
  if (to == null) return undefined;
  if (
    item.issue.kind === "idea" &&
    item.state?.ideaStatus === "awaiting-approval"
  ) {
    const projectId = projectIdOf(item.issue.id, indexes.byId);
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
  indexes: TreeRowIndexes;
  avatar?: ReactNode;
  actions?: ReactNode;
  /** Row-attached launch fault; retry is the restored Play control. */
  launchFault?: string;
  /** When set, the full row drills in here; actions stay outside the link. */
  to?: string;
  drillInState?: unknown;
  /** Project name shown on the row. Recently merged names each row's project. */
  projectTitle?: string;
}

/**
 * Cockpit flow row: state disc on the bucket rail, a reserved icon slot left
 * of the title, gate toggles left of that slot, chips snug after the title.
 */
export function FlowRow({
  item,
  indexes,
  avatar,
  actions,
  launchFault,
  to,
  drillInState,
  projectTitle,
}: FlowRowProps) {
  const railState = issueRailNodeState(item.issue, item.state, indexes);
  const live = railState === "in-flight" && !isWorkQueuedRoot(item.issue);
  const count = leafTaskProgressCount(item.issue, indexes);
  const drillInTo = flowRowDrillInTo(item, indexes, to);
  const chips = flowRowStatusChips(item, indexes);
  const attention = flowRowShowsAttentionTriangle(item);
  const blocked = Boolean(item.state?.blocked);
  const gates =
    isCapturedIdeaFlowItem(item) && item.issue.stakeholder ? (
      <PlanningFlowRowGates issue={item.issue} />
    ) : null;
  const meta =
    chips != null || attention || blocked || count != null ? (
      <span className="cockpit-row-meta inline-flex items-center gap-1.5">
        {chips}
        {attention ? (
          <AlertTriangle
            aria-label="needs attention"
            className="h-3.5 w-3.5 shrink-0 [color:hsl(var(--warning))]"
          />
        ) : null}
        {blocked ? (
          <AlertCircle
            aria-label="blocked"
            className="h-3.5 w-3.5 shrink-0 [color:hsl(var(--blocked))]"
          />
        ) : null}
        {count != null ? (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {count}
          </span>
        ) : null}
      </span>
    ) : null;

  return (
    <RailNode
      state={railState}
      edge={item.state?.blocked ? "dashed" : "solid"}
      glow={live}
      className="items-start py-1"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div
          className={cn(
            "relative flex min-w-0 flex-1 flex-wrap items-start gap-2 rounded-lg border border-border bg-card px-3.5 py-[11px] shell:flex-nowrap shell:items-center",
          )}
        >
          {drillInTo != null ? (
            <Link
              to={drillInTo}
              state={drillInState}
              aria-label={
                projectTitle
                  ? `${item.issue.title}, ${projectTitle}`
                  : item.issue.title
              }
              className="absolute inset-0 z-0 rounded-lg"
            />
          ) : null}
          {gates ? (
            <span
              data-testid="cockpit-row-gates"
              className={cn(
                "relative z-[1] inline-flex max-w-full shrink-0 flex-wrap items-center gap-1",
                drillInTo != null && "pointer-events-auto",
              )}
            >
              {gates}
            </span>
          ) : null}
          <div
            className={cn(
              "relative z-[1] flex min-w-[calc(2.75rem+5ch+0.5rem)] max-w-full flex-1 items-start gap-2 shell:min-w-0",
              drillInTo != null && "pointer-events-none",
            )}
          >
            {avatar != null ? (
              <span className="inline-flex shrink-0">{avatar}</span>
            ) : null}
            <span
              data-testid="cockpit-row-action-slot"
              className={cn(
                "cockpit-row-action-slot",
                drillInTo != null && "pointer-events-auto",
              )}
            >
              {actions}
            </span>
            <div className="cockpit-row-pack">
              <div className="cockpit-row-cluster">
                {projectTitle ? (
                  <span
                    data-testid="cockpit-row-project"
                    className="max-w-[11rem] shrink-0 truncate font-mono text-[11px] font-normal text-muted-foreground"
                    title={projectTitle}
                  >
                    {projectTitle}
                  </span>
                ) : null}
                <span className="cockpit-row-title font-medium text-foreground" title={item.issue.title}>
                  {item.issue.title}
                </span>
                {meta}
              </div>
              <span className="cockpit-row-spacer" aria-hidden />
            </div>
          </div>
        </div>
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
