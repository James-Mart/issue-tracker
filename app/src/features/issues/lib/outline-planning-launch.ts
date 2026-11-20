import { agentBodyPath, skillPath } from "@/lib/plugin-paths";
import type { OutlineSessionRole } from "@server/schemas";
import { planningSessionTitle } from "./planning-launch";

/**
 * Session root model. Matches the planner wrapper pins:
 * Opus when the source Idea's stakeholder is an Opus model, otherwise Grok.
 */
export const OUTLINE_PLANNING_GROK_MODEL = "cursor-grok-4.7";
export const OUTLINE_PLANNING_OPUS_MODEL = "claude-opus-5-5-thinking-high";

/** Execution gate for one root. `on` waits for a human start; `off` queues the root at release. */
export type OutlineExecutionGate = "on" | "off";

/**
 * Execution gate from the outline's stored settings, as release applies it
 * and a decomposer run is told it. `auto` follows `codeApprovalRequired`:
 * required waits, otherwise start.
 */
export function resolveExecutionGate(
  executionGate: "auto" | boolean | undefined,
  codeApprovalRequired: boolean | undefined,
): OutlineExecutionGate {
  if (executionGate === true) return "on";
  if (executionGate === false) return "off";
  return codeApprovalRequired === true ? "on" : "off";
}

/** Session title for a run on an outline. */
export function outlinePlanningSessionTitle(
  role: OutlineSessionRole,
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

/** Prompt text for one optional plan field. An omitted field is `unset`. */
function planSettingPromptLabel(value: string | boolean | undefined): string {
  if (value === undefined) return "unset";
  return String(value);
}

/**
 * First prompt for a new planner session. Plan settings come from the
 * outline; `brief` is the revision the grill starts from.
 */
export function outlineNewPlanningSessionMessage(
  outline: {
    id: string;
    bodyVersion: number;
    executionGate?: "auto" | boolean;
    codeApprovalRequired?: boolean;
    mergeBase?: string;
    mergePolicy?: string;
    outOfBand?: boolean;
  },
  brief: string,
): string {
  return (
    `Start a new planning session on ${outline.id} in the issue tracker. ` +
    `Read ${skillPath("issue-tracker-plan")} and follow it. ` +
    `Outline: \`${outline.id}\`. Version: \`${outline.bodyVersion}\`. ` +
    `Execution gate: \`${planSettingPromptLabel(outline.executionGate)}\`. ` +
    `Code approval required: \`${planSettingPromptLabel(outline.codeApprovalRequired)}\`. ` +
    `Merge base: \`${planSettingPromptLabel(outline.mergeBase)}\`. ` +
    `Merge policy: \`${planSettingPromptLabel(outline.mergePolicy)}\`. ` +
    `Out of band: \`${planSettingPromptLabel(outline.outOfBand)}\`.\n` +
    `Brief:\n${brief}`
  );
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
