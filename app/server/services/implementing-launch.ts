import type { AgentModel } from "@/features/agents/api/client";
import { skillPath } from "@/lib/plugin-paths";
import type { ConversationChannel, IssueDetail } from "../schemas.js";
import { defaultConversationModel } from "../../src/features/issues/lib/planning-launch.js";

/** Root-agent model for the work-loop coordinator. */
export const WORK_LOOP_COORDINATOR_MODEL = "composer-2.5";

export type ImplementingWorkRoot = Extract<
  IssueDetail,
  { kind: "epic" | "story" }
>;

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

/** First prompt naming the work-root id and skill to load, then any resume note. */
export function implementingSessionMessage(
  issueId: string,
  resumeNote?: string,
): string {
  const message =
    `Work ${issueId} in the issue tracker using the issue-tracker-work skill. ` +
    `Read ${skillPath("issue-tracker-work")} and follow it.`;
  return resumeNote ? `${message}\n\nMessage from the human:\n${resumeNote}` : message;
}

/** Resume prompt for an existing coordinator session from Overview. */
export function implementingResumePrompt(): string {
  return "Resume coordination to complete any unfinished tasks.";
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
      "Queue this work. It starts when it is next and a slot is free — the coordinator assigns models, spawns implementors and validators, and drives git until the stack is done. Watch and interject here.",
    actionLabel: "Queue",
  };
}

/** Epic, or a Story whose parent is a Project. */
export function isImplementingWorkRootIssue(
  kind: string,
  parentKind: string | undefined,
): boolean {
  return kind === "epic" || (kind === "story" && parentKind === "project");
}

/** True when this issue offers the implementing channel as a work root. */
export function isImplementingWorkRoot(
  channel: ConversationChannel,
  issue: IssueDetail | undefined,
  parentKind?: string,
): issue is ImplementingWorkRoot {
  if (channel !== "implementing" || issue == null) return false;
  return isImplementingWorkRootIssue(issue.kind, parentKind);
}
