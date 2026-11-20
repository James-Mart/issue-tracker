import type {
  ConversationChannel,
  ConversationMeta,
  DerivedState,
  Issue,
  OutlineSessionRole,
} from "../schemas.js";
import { appendTargetOutlineId, outlineIdOnStory } from "./append-target.js";
import {
  channelPredecessors,
  isOpenChannelSession,
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

function outlinePlanner(
  session: ConversationMeta | undefined,
): ConversationMeta | undefined {
  if (!session || !isPlannerOutlineRole(session.outlineRole)) return undefined;
  return session;
}

/** The outline's one live planning session, which is its planner. */
export function activeOutlinePlanner(
  outlineId: string,
): ConversationMeta | undefined {
  return outlinePlanner(channelPredecessors(outlineId, "planning")[0]);
}

/**
 * One walk of `metas`. `planners` is the first open planning session per
 * issue (`channelPredecessors(issueId, "planning")[0]`). `forkedFrom` groups
 * those sessions by the planner they forked from.
 */
function planningLockIndex(metas: readonly ConversationMeta[]): {
  planners: Map<string, ConversationMeta>;
  forkedFrom: Map<string, ConversationMeta[]>;
} {
  const planners = new Map<string, ConversationMeta>();
  const forkedFrom = new Map<string, ConversationMeta[]>();
  for (const session of metas) {
    if (!session.issueId) continue;
    if (!isOpenChannelSession(session, "planning", session.issueId)) continue;
    if (!planners.has(session.issueId)) planners.set(session.issueId, session);
    if (!session.forkedFrom) continue;
    const group = forkedFrom.get(session.forkedFrom);
    if (group) group.push(session);
    else forkedFrom.set(session.forkedFrom, [session]);
  }
  return { planners, forkedFrom };
}

function appendLockForPlanner(
  outlineId: string,
  plannerId: string,
  issuesById: ReadonlyMap<string, Issue>,
  forkedFrom: ReadonlyMap<string, readonly ConversationMeta[]>,
): AppendOutlineLock | undefined {
  for (const session of forkedFrom.get(plannerId) ?? []) {
    const holder = appendLockHolderFromSession(session, outlineId, issuesById);
    if (holder) {
      return { outlineId, ideaId: holder.id, ideaTitle: holder.title };
    }
  }
  return undefined;
}

/** The append Idea holding this outline's planner lock, from the current derived list. */
export function appendOutlineLock(outlineId: string): AppendOutlineLock | undefined {
  return appendLockOnOutline(outlineId, list().derived);
}

/** Stamp `appendLock` on each locked outline. Absent when the outline is not locked. */
export function applyAppendLocks(
  issues: readonly Issue[],
  derived: Record<string, DerivedState>,
): void {
  const { planners, forkedFrom } = planningLockIndex(
    listIndexedConversationMetas(),
  );
  const issuesById = new Map(issues.map((item) => [item.id, item]));
  for (const issue of issues) {
    if (issue.kind !== "outline") continue;
    const planner = outlinePlanner(planners.get(issue.id));
    if (!planner) continue;
    const lock = appendLockForPlanner(
      issue.id,
      planner.id,
      issuesById,
      forkedFrom,
    );
    if (!lock) continue;
    derived[issue.id].appendLock = {
      ideaId: lock.ideaId,
      ideaTitle: lock.ideaTitle,
    };
  }
}

function appendLockOnOutline(
  outlineId: string,
  derived: Record<string, DerivedState>,
): AppendOutlineLock | undefined {
  const appendLock = derived[outlineId]?.appendLock;
  if (!appendLock) return undefined;
  return { outlineId, ideaId: appendLock.ideaId, ideaTitle: appendLock.ideaTitle };
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
  const lock = appendLockOnOutline(outlineId, list().derived);
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
  const { issues, derived } = list();
  const issue = issues.find((item) => item.id === issueId);
  if (!issue) return;

  if (issue.kind === "outline") {
    if (!isPlannerOutlineRole(outlineRole)) return;
    const lock = appendLockOnOutline(issueId, derived);
    if (lock) throw lockConflict(lock, "new planning session is refused");
    return;
  }

  if (issue.kind !== "idea" || !issue.appendTo) return;
  const outlineId = appendTargetOutlineId(issues, issue.appendTo);
  if (!outlineId) return;
  const lock = appendLockOnOutline(outlineId, derived);
  if (!lock) return;
  // The lock holder may continue its own planning session while the outline is locked.
  if (lock.ideaId === issueId) return;
  throw lockConflict(lock, "another append Idea's planning start is refused");
}