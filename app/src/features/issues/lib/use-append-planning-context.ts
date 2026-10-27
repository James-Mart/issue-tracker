import { useMemo } from "react";
import type { DerivedState, IssueRecord } from "@server/schemas";
import {
  appendPlanningContextForStory,
  appendPlanningRefusal,
  type AppendPlanningContext,
} from "@server/append-planning-context";
import { useIssuesQuery, useProjectWorktreesQuery } from "../api/queries";
import { appendStoryTarget } from "./append-target";
import { issuesById } from "./build-tree";

type IdeaRecord = Extract<IssueRecord, { kind: "idea" }>;

type AppendPlanningPhase =
  | { phase: "absent" }
  | { phase: "loading"; storyTitle: string; mergeBase?: string }
  | { phase: "ready"; storyTitle: string; context: AppendPlanningContext };

export type AppendPlanningView = AppendPlanningPhase & {
  ideaDerived: DerivedState | undefined;
  /** Closed or merged sentence. Open and loading planning have none. */
  refusal: string | undefined;
  /** True while the worktree query is in flight, or when planning cannot start. */
  launchBlocked: boolean;
};

function withLaunchGate(
  view: AppendPlanningPhase & { ideaDerived: DerivedState | undefined },
): AppendPlanningView {
  if (view.phase === "loading") {
    return { ...view, refusal: undefined, launchBlocked: true };
  }
  if (view.phase === "ready") {
    const refusal = appendPlanningRefusal(view.context);
    return { ...view, refusal, launchBlocked: Boolean(refusal) };
  }
  return { ...view, refusal: undefined, launchBlocked: false };
}

/** Resolved append-planning context for an issue, absent when it does not append. */
export function useAppendPlanningContext(
  issue: IssueRecord,
): AppendPlanningView {
  const { data } = useIssuesQuery();
  const byId = useMemo(() => issuesById(data?.issues ?? []), [data?.issues]);
  const idea: IdeaRecord | undefined = issue.kind === "idea" ? issue : undefined;
  const target = idea
    ? appendStoryTarget(idea.appendTo, idea.partOf, byId)
    : undefined;
  const worktrees = useProjectWorktreesQuery(idea && target ? idea.partOf : "");
  const ideaDerived = idea && data?.derived ? data.derived[idea.id] : undefined;

  if (!idea || !target) return withLaunchGate({ phase: "absent", ideaDerived });

  const mergeBase = data?.derived?.[target.id]?.mergeBase;
  if (target.merged) {
    return withLaunchGate({
      phase: "ready",
      storyTitle: target.title,
      ideaDerived,
      context: appendPlanningContextForStory(target, mergeBase, false),
    });
  }

  if (!worktrees.isFetched) {
    return withLaunchGate({
      phase: "loading",
      storyTitle: target.title,
      ideaDerived,
      ...(mergeBase ? { mergeBase } : {}),
    });
  }

  return withLaunchGate({
    phase: "ready",
    storyTitle: target.title,
    ideaDerived,
    context: appendPlanningContextForStory(
      target,
      mergeBase,
      worktrees.data?.worktrees[target.id]?.exists === true,
    ),
  });
}
