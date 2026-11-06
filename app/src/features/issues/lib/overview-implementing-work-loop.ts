import type {
  ChannelSessionListItem,
  IssueKind,
  IssueRecord,
  IssuesResponse,
} from "@server/schemas";
import {
  isImplementingWorkRoot,
  type ImplementingWorkRoot,
} from "@server/services/implementing-launch";
import { leafTasksOf } from "./derived";
import {
  overviewWorkLoopAction,
  type OverviewWorkLoopAction,
} from "./overview-work-loop-action";

export function overviewQueueToolbarSkipped(
  sessionsLoading: boolean,
  workLoopAction: OverviewWorkLoopAction,
): boolean {
  return sessionsLoading || workLoopAction.action === "hidden";
}

/**
 * Subset of `useWorkRootLaunchFacts` output used to resolve the Overview work-loop action.
 */
export type WorkRootLaunchFactsForOverview = {
  list: Pick<IssuesResponse, "issues" | "derived"> | undefined;
  record: Extract<IssueRecord, { kind: "epic" | "story" }> | undefined;
  sessionsLoading: boolean;
  currentSession: ChannelSessionListItem | undefined;
  finished: boolean;
  holdsSlot: boolean;
  queued: boolean;
  parked: boolean;
  liveRun: boolean;
};

export function resolveImplementingOverviewWorkLoop(
  issue: ImplementingWorkRoot,
  parentKind: IssueKind | undefined,
  facts: WorkRootLaunchFactsForOverview,
): OverviewWorkLoopAction {
  if (!isImplementingWorkRoot("implementing", issue, parentKind)) {
    return { action: "hidden" };
  }
  if (!facts.record) return { action: "hidden" };
  const issues = facts.list?.issues ?? [];
  return overviewWorkLoopAction({
    liveRun: facts.liveRun,
    leafTasks: leafTasksOf(facts.record, issues),
    currentSession: facts.currentSession,
    queued: facts.queued || Boolean(issue.workQueuedAt),
    holdsSlot: facts.holdsSlot,
    parked: facts.parked || Boolean(issue.workParkedAt),
    finished: facts.finished,
    archived: Boolean(facts.record.archived),
  });
}
