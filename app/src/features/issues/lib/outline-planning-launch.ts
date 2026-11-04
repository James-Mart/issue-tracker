import { agentBodyPath } from "@/lib/plugin-paths";
import {
  planningSessionMessage,
  planningSessionTitle,
} from "./planning-launch";

/**
 * Session root model. Matches the planner and decomposer wrapper pins:
 * Opus when the source Idea's stakeholder is an Opus model, otherwise Grok.
 */
export const OUTLINE_PLANNING_GROK_MODEL = "cursor-grok-4.7";
export const OUTLINE_PLANNING_OPUS_MODEL = "claude-opus-5-5-thinking-high";

export type OutlinePlanningRole = "planner" | "decomposer" | "reconcile" | "check";

/** Execution gate for one decomposer run. `off` queues the new root after polish. */
export type OutlineExecutionGate = "on" | "off";

/** Session title for a planning-channel run on an outline. */
export function outlinePlanningSessionTitle(
  role: OutlinePlanningRole,
  outlineTitle: string,
): string {
  if (role === "planner") return planningSessionTitle(outlineTitle);
  if (role === "reconcile") return `Reconcile ${outlineTitle}`;
  if (role === "check") return `Check ${outlineTitle}`;
  return `Decompose ${outlineTitle}`;
}

/** Opus pin when `stakeholder` names an Opus model; Grok otherwise. */
export function outlinePlanningSessionModel(
  stakeholder: string | undefined,
): string {
  if (stakeholder !== undefined && stakeholder.toLowerCase().includes("opus")) {
    return OUTLINE_PLANNING_OPUS_MODEL;
  }
  return OUTLINE_PLANNING_GROK_MODEL;
}

/** First prompt for a planner session: the Idea grill, with no stakeholder. */
export function outlinePlannerSessionMessage(ideaId: string): string {
  return planningSessionMessage(ideaId, undefined);
}

/** First prompt for a decomposer session on one outline version. */
export function outlineDecomposerSessionMessage(input: {
  outlineId: string;
  version: number;
  executionGate: OutlineExecutionGate;
  mergePolicy?: string;
}): string {
  const message =
    `Decompose ${input.outlineId} in the issue tracker. ` +
    `Read ${agentBodyPath("_issue-tracker-decomposer")} and follow it. ` +
    `Mode: \`decompose\`. ` +
    `Outline: \`${input.outlineId}\`. Version: \`${input.version}\`. ` +
    `Execution gate: \`${input.executionGate}\`.`;
  if (!input.mergePolicy) return message;
  return `${message} Merge policy: \`${input.mergePolicy}\`.`;
}

/** Optional reconcile inputs a triggering flow passes along with the version. */
export type OutlineReconcileScope = {
  targetStory?: string;
  coveredBy?: readonly string[];
  sourceIdea?: string;
};

/** First prompt for reconciling linked roots to one new outline version. */
export function outlineReconcileSessionMessage(
  input: { outlineId: string; version: number } & OutlineReconcileScope,
): string {
  const message =
    `Reconcile ${input.outlineId} in the issue tracker. ` +
    `Read ${agentBodyPath("_issue-tracker-decomposer")} and follow it. ` +
    `Mode: \`reconcile\`. ` +
    `Outline: \`${input.outlineId}\`. Version: \`${input.version}\`.`;
  const target = input.targetStory
    ? ` Target story: \`${input.targetStory}\`.`
    : "";
  const covered =
    input.coveredBy && input.coveredBy.length > 0
      ? ` Covered by: ${input.coveredBy.map((id) => `\`${id}\``).join(", ")}.`
      : "";
  const idea = input.sourceIdea
    ? ` Source idea: \`${input.sourceIdea}\`.`
    : "";
  return `${message}${target}${covered}${idea}`;
}

/** First prompt for checking an outline against submitted review threads. */
export function outlineCheckSessionMessage(input: {
  outlineId: string;
  reviewId: string;
  submissionId: string;
  storyId: string;
  threadIds: readonly string[];
}): string {
  return (
    `Check ${input.outlineId} against review feedback in the issue tracker. ` +
    `Read ${agentBodyPath("_issue-tracker-outline-check")} and follow it. ` +
    `Outline: \`${input.outlineId}\`. Review: \`${input.reviewId}\`. ` +
    `Submission: \`${input.submissionId}\`. Story: \`${input.storyId}\`. ` +
    `Threads: ${input.threadIds.map((id) => `\`${id}\``).join(", ")}.`
  );
}

/** Empty planning tab on an outline. The server starts the run. */
export const OUTLINE_PLANNING_EMPTY_TITLE = "No planning session.";
export const OUTLINE_PLANNING_EMPTY_DETAIL =
  "No planner or decomposer run has been started on this outline. When one starts, it opens here.";
