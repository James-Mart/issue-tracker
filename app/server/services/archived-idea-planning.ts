import type { ConversationChannel } from "../schemas.js";
import { IssueError } from "./errors.js";
import { readIssueOrThrow } from "./issues.js";

/** Refuse a new planning session, or a prompt to a planning conversation, on an archived Idea. */
export function refuseArchivedIdeaPlanning(
  issueId: string,
  channel: ConversationChannel,
): void {
  if (channel !== "planning") return;
  const issue = readIssueOrThrow(issueId);
  if (issue.kind !== "idea" || !issue.archived) return;
  throw new IssueError(
    "conflict",
    `idea "${issueId}" is archived; its planning conversation is read-only`,
  );
}
