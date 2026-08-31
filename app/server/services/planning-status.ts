import type { IdeaStatus, Issue } from "../schemas.js";
import {
  conversationHasTranscript,
  listConversations,
} from "./conversations.js";
import { isRunLive } from "./run-live.js";
import { ideaIdsWithPlanRoot } from "./planning-work-root.js";

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

function statusForIdea(
  conversationIds: string[] | undefined,
  hasPlanRoot: boolean,
  approvalPending: boolean,
): IdeaStatus {
  if (conversationIds?.some((id) => isRunLive(id))) return "planning";
  if (hasPlanRoot) return "planned";
  if (approvalPending) return "awaiting-approval";
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
      issue.approvalPending === true,
    );
  }
  return byId;
}
