import type {
  ConversationChannel,
  ConversationMeta,
  Issue,
  OutlineSessionRole,
} from "../schemas.js";
import { appendTargetOutlineId, outlineIdOnStory } from "./append-target.js";
import {
  channelPredecessors,
  listIndexedConversationMetas,
} from "./conversation-meta-index.js";
import { IssueError } from "./errors.js";
import { list, readIssueOrThrow } from "./issues.js";

export type AppendOutlineLock = {
  outlineId: string;
  ideaId: string;
  ideaTitle: string;
};

function isPlannerOutlineRole(role: OutlineSessionRole | undefined): boolean {
  return role === undefined || role === "planner";
}

/** The outline's one live planning session, which is its planner. */
export function activeOutlinePlanner(
  outlineId: string,
): ConversationMeta | undefined {
  const [session] = channelPredecessors(outlineId, "planning");
  if (!session || !isPlannerOutlineRole(session.outlineRole)) return undefined;
  return session;
}

/**
 * An outline is locked while an unarchived append Idea has a non-archived
 * planning session forked from that outline's active planner.
 */
export function appendOutlineLock(outlineId: string): AppendOutlineLock | undefined {
  const planner = activeOutlinePlanner(outlineId);
  if (!planner) return undefined;
  const { issues } = list();
  const issuesById = new Map(issues.map((item) => [item.id, item]));
  const candidates = listIndexedConversationMetas().filter(
    (session) =>
      !session.archived &&
      session.channel === "planning" &&
      session.forkedFrom === planner.id &&
      session.issueId,
  );
  for (const session of candidates) {
    const holder = appendLockHolderFromSession(
      session,
      outlineId,
      issuesById,
    );
    if (holder) {
      return { outlineId, ideaId: holder.id, ideaTitle: holder.title };
    }
  }
  return undefined;
}

function appendLockHolderFromSession(
  session: ConversationMeta,
  outlineId: string,
  issuesById: ReadonlyMap<string, Issue>,
): Issue | undefined {
  const idea = issuesById.get(session.issueId!);
  if (idea?.kind !== "idea" || idea.archived || !idea.appendTo) return undefined;
  if (outlineIdOnStory(issuesById.get(idea.appendTo)) !== outlineId) {
    return undefined;
  }
  return idea;
}

export function outlineIdForActivePlanner(
  conversationId: string,
): string | undefined {
  const meta = listIndexedConversationMetas().find(
    (session) => session.id === conversationId,
  );
  if (!meta || meta.archived || !meta.issueId || meta.channel !== "planning") {
    return undefined;
  }
  const issue = readIssueOrThrow(meta.issueId);
  if (issue.kind !== "outline" || !isPlannerOutlineRole(meta.outlineRole)) {
    return undefined;
  }
  const active = activeOutlinePlanner(meta.issueId);
  if (active?.id !== conversationId) return undefined;
  return meta.issueId;
}

function lockConflict(lock: AppendOutlineLock, action: string): IssueError {
  return new IssueError(
    "conflict",
    `outline "${lock.outlineId}" is locked while idea "${lock.ideaId}" plans an append; ${action}`,
    {
      holderIssueId: lock.ideaId,
      holderIssueTitle: lock.ideaTitle,
    },
  );
}

/** Refuse a prompt to the outline's active planner while an append holds the lock. */
export function refuseOutlinePlannerLockPrompt(conversationId: string): void {
  const outlineId = outlineIdForActivePlanner(conversationId);
  if (!outlineId) return;
  const lock = appendOutlineLock(outlineId);
  if (lock) throw lockConflict(lock, "its planner is read-only");
}

/**
 * Refuse a new planner session on the outline, or a second append Idea's
 * planning start, while the lock holds.
 */
export function refuseOutlineAppendLockCreate(
  issueId: string,
  channel: ConversationChannel,
  outlineRole: OutlineSessionRole | undefined,
): void {
  if (channel !== "planning") return;
  const { issues } = list();
  const issue = issues.find((item) => item.id === issueId);
  if (!issue) return;

  if (issue.kind === "outline") {
    if (!isPlannerOutlineRole(outlineRole)) return;
    const lock = appendOutlineLock(issueId);
    if (lock) throw lockConflict(lock, "new planning session is refused");
    return;
  }

  if (issue.kind !== "idea" || !issue.appendTo) return;
  const outlineId = appendTargetOutlineId(issues, issue.appendTo);
  if (!outlineId) return;
  const lock = appendOutlineLock(outlineId);
  if (!lock) return;
  // The lock holder may continue its own planning session while the outline is locked.
  if (lock.ideaId === issueId) return;
  throw lockConflict(lock, "another append Idea's planning start is refused");
}