import type { IdeaStatus, Issue } from "../schemas.js";
import {
  conversationHasTranscript,
  listConversations,
} from "./conversations.js";
import { isRunLive } from "./run-live.js";
import { readDescription } from "./issues.js";
import { descriptionBacklinksIdea } from "./planning-work-root.js";

function planningSessionsByIssueId(): Map<string, string[]> {
  const byIssueChannel = new Map<string, string[]>();
  for (const meta of listConversations()) {
    if (meta.issueId === undefined || meta.channel === undefined) continue;
    const key = `${meta.issueId}\0${meta.channel}`;
    const bucket = byIssueChannel.get(key);
    if (bucket) bucket.push(meta.id);
    else byIssueChannel.set(key, [meta.id]);
  }

  const planning = new Map<string, string[]>();
  for (const [key, conversationIds] of byIssueChannel) {
    const sep = key.indexOf("\0");
    if (key.slice(sep + 1) !== "planning") continue;
    planning.set(key.slice(0, sep), conversationIds);
  }
  return planning;
}

function ideaIdsWithPlanRoot(issues: Issue[]): Set<string> {
  const ideaIdsByProject = new Map<string, string[]>();
  for (const issue of issues) {
    if (issue.kind !== "idea") continue;
    const bucket = ideaIdsByProject.get(issue.partOf);
    if (bucket) bucket.push(issue.id);
    else ideaIdsByProject.set(issue.partOf, [issue.id]);
  }

  const planned = new Set<string>();
  for (const issue of issues) {
    if (issue.kind !== "epic" && issue.kind !== "story") continue;
    const ideaIds = ideaIdsByProject.get(issue.partOf);
    if (!ideaIds) continue;
    const description = readDescription(issue.id);
    for (const ideaId of ideaIds) {
      if (planned.has(ideaId)) continue;
      if (descriptionBacklinksIdea(description, ideaId)) planned.add(ideaId);
    }
  }
  return planned;
}

function statusForIdea(
  conversationIds: string[] | undefined,
  hasPlanRoot: boolean,
): IdeaStatus {
  if (conversationIds?.some((id) => isRunLive(id))) return "planning";
  if (hasPlanRoot) return "planned";
  if (conversationIds?.some((id) => conversationHasTranscript(id))) {
    return "awaiting-direction";
  }
  return "captured";
}

/** Derived planning state for every Idea, resolved in one pass over the signals. */
export function planningStatusById(issues: Issue[]): Record<string, IdeaStatus> {
  const sessionsByIdea = planningSessionsByIssueId();
  const plannedIds = ideaIdsWithPlanRoot(issues);
  const byId: Record<string, IdeaStatus> = {};
  for (const issue of issues) {
    if (issue.kind !== "idea") continue;
    byId[issue.id] = statusForIdea(
      sessionsByIdea.get(issue.id),
      plannedIds.has(issue.id),
    );
  }
  return byId;
}
