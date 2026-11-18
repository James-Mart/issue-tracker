import type { ProjectRecord } from "@/features/issues/lib/build-tree";
import {
  COMPOSER_25_MODEL_ID,
  agentModelIdIfListed,
} from "@/features/issues/lib/planning-launch";
import type { AgentModel } from "../api/client";

export const NEW_CONVERSATION_DEFAULT_PROJECT_ID = "issue-tracker";

/** Whether the project has a workspace path agents can run in. */
export function projectHasUsableWorkspace(project: ProjectRecord): boolean {
  return Boolean(project.workspace?.trim());
}

/**
 * Default Project for New conversation when issue-tracker is listed with a
 * workspace; otherwise "" so the select stays unset (catalog may omit it).
 */
export function defaultNewConversationProjectId(
  projects: readonly ProjectRecord[],
): string {
  const project = projects.find(
    (entry) => entry.id === NEW_CONVERSATION_DEFAULT_PROJECT_ID,
  );
  return project && projectHasUsableWorkspace(project) ? project.id : "";
}

/**
 * Default Model for New conversation when Composer 2.5 is in the catalog;
 * otherwise "" so the select stays unset rather than picking another id.
 */
export function defaultNewConversationModelId(
  models: readonly AgentModel[],
): string {
  return agentModelIdIfListed(models, COMPOSER_25_MODEL_ID) ?? "";
}