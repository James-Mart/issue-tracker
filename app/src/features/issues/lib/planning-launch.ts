import type { AgentModel } from "@/features/agents/api/client";

/** Session title for a planning run on an Idea. */
export function planningSessionTitle(ideaTitle: string): string {
  return `Plan ${ideaTitle}`;
}

/**
 * Root-agent model: stakeholder slug when set, else fallbackCatalogId.
 * @param fallbackCatalogId Catalog id used when stakeholder is unset.
 */
export function planningSessionModel(
  stakeholder: string | undefined,
  fallbackCatalogId: string,
): string {
  return stakeholder ?? fallbackCatalogId;
}

/** First prompt naming the Idea id and skill to load. */
export function planningSessionMessage(
  ideaId: string,
  stakeholder: string | undefined,
): string {
  if (stakeholder) {
    return (
      `Plan ${ideaId} in the issue tracker using the issue-tracker-auto-plan skill. ` +
      `Stakeholder stand-in model: ${stakeholder}.`
    );
  }
  return `Plan ${ideaId} in the issue tracker using the issue-tracker-plan skill.`;
}

export type PlanningLaunchCopy = {
  title: string;
  detail: string;
  actionLabel: string;
};

function stakeholderDisplayName(
  stakeholder: string,
  models: readonly AgentModel[],
): string {
  return models.find((model) => model.id === stakeholder)?.displayName ?? stakeholder;
}

/** ShellState copy and primary action label from the current stakeholder field. */
export function planningLaunchCopy(
  stakeholder: string | undefined,
  models: readonly AgentModel[] = [],
): PlanningLaunchCopy {
  if (stakeholder) {
    const name = stakeholderDisplayName(stakeholder, models);
    return {
      title: "No planning session.",
      detail: `Start auto-plan with ${name} standing in as stakeholder. You can watch and interject, but the grill runs without your answers.`,
      actionLabel: `Start auto-plan on ${name}`,
    };
  }
  return {
    title: "No planning session.",
    detail:
      "Start a planning grill — you answer the questions in this channel.",
    actionLabel: "Start planning grill",
  };
}

/** Default conversation model: first listed agent model. */
export function defaultConversationModel(
  models: readonly AgentModel[],
): string | undefined {
  return models[0]?.id;
}
