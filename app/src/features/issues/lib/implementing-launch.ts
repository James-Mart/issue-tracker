import type { AgentModel } from "@/features/agents/api/client";
import { ApiError } from "@/lib/api/errors";
import type { ConversationChannel, IssueDetail } from "@server/schemas";
import { defaultConversationModel } from "./planning-launch";

/** Root-agent model for the work-loop coordinator. */
export const WORK_LOOP_COORDINATOR_MODEL = "composer-2.5";

export type ImplementingWorkRoot = Extract<
  IssueDetail,
  { kind: "epic" | "story" }
>;

export type ImplementingLockRefusal = {
  holderIssueId: string;
  holderIssueTitle: string;
};

/** Session title for an implementing run on an Epic or project-level Story. */
export function implementingSessionTitle(issueTitle: string): string {
  return `Implement ${issueTitle}`;
}

/** Coordinator model: Composer 2.5 when listed, else the default conversation model. */
export function implementingSessionModel(
  models: readonly AgentModel[],
): string | undefined {
  if (models.some((model) => model.id === WORK_LOOP_COORDINATOR_MODEL)) {
    return WORK_LOOP_COORDINATOR_MODEL;
  }
  return defaultConversationModel(models);
}

/** First prompt naming the work-root id and skill to load. */
export function implementingSessionMessage(issueId: string): string {
  return `Work ${issueId} in the issue tracker using the issue-tracker-work skill.`;
}

export type ImplementingLaunchCopy = {
  title: string;
  detail: string;
  actionLabel: string;
};

/** ShellState copy and primary action label for the implementing empty state. */
export function implementingLaunchCopy(): ImplementingLaunchCopy {
  return {
    title: "No implementing session.",
    detail:
      "Start the work loop — the coordinator assigns models, spawns implementors and validators, and drives git until the stack is done. Watch and interject here.",
    actionLabel: "Start work loop",
  };
}

export function implementingLockRefusalCopy(holderIssueTitle: string): {
  title: string;
  detailPrefix: string;
} {
  return {
    title: "Another implementing run is active.",
    detailPrefix: `Only one work loop can run at a time. ${holderIssueTitle} is holding the lock — open its`,
  };
}

/** True when this issue offers the implementing channel as a work root. */
export function isImplementingWorkRoot(
  channel: ConversationChannel,
  issue: IssueDetail | undefined,
  parentKind?: string,
): issue is ImplementingWorkRoot {
  if (channel !== "implementing" || issue == null) return false;
  if (issue.kind === "epic") return true;
  return issue.kind === "story" && parentKind === "project";
}

/** Parse a Project implementing-lock 409 into holder fields. */
export function parseImplementingLockRefusal(
  err: unknown,
): ImplementingLockRefusal | undefined {
  if (!(err instanceof ApiError) || err.status !== 409) return undefined;
  const body = err.body;
  if (!body || typeof body !== "object") return undefined;
  const record = body as Record<string, unknown>;
  const holderIssueId = record.holderIssueId;
  const holderIssueTitle = record.holderIssueTitle;
  if (
    typeof holderIssueId !== "string" ||
    typeof holderIssueTitle !== "string"
  ) {
    return undefined;
  }
  return { holderIssueId, holderIssueTitle };
}
