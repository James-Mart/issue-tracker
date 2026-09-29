import type {
  AgentRun,
  DelegationRecordWithEnd,
  Issue,
  TranscriptEvent,
} from "../schemas.js";
import {
  activeImplementingConversationId,
  listConversationIds,
  readConversation,
  readConversationMeta,
  readDelegations,
} from "./conversations.js";
import {
  conversationIdFromReviewTaskerDelegation,
  reviewTaskerRunsForIssue,
} from "./review-tasking.js";
import { ancestorChain, nearestImplementingWorkRootId } from "./subtree.js";

export type AgentRunsWorkRoot = {
  issueId: string;
  conversationId: string;
};

type SubagentUpdateEvent = Extract<TranscriptEvent, { type: "subagent_update" }>;

function deriveRunStatus(record: DelegationRecordWithEnd): {
  status: AgentRun["status"];
  endedAt?: string;
} {
  if (record.end !== undefined) {
    return { status: record.end.status, endedAt: record.end.endedAt };
  }
  if (record.lifecycle === "tracked") {
    return { status: "running" };
  }
  return { status: "unknown" };
}

function runsForConversation(
  conversationId: string,
  issueId: string,
  delegations: DelegationRecordWithEnd[],
): AgentRun[] {
  const runs: AgentRun[] = [];
  const seenAgentIds = new Set<string>();

  for (const record of delegations) {
    if (record.issueId !== issueId || !record.parentCallId) continue;

    const derived = deriveRunStatus(record);
    const isResume = seenAgentIds.has(record.agentId);
    seenAgentIds.add(record.agentId);

    runs.push({
      delegationId: record.delegationId,
      agentId: record.agentId,
      role: record.role,
      model: record.model,
      issueId: record.issueId,
      parentCallId: record.parentCallId,
      conversationId,
      startedAt: record.at,
      status: derived.status,
      ...(derived.endedAt !== undefined ? { endedAt: derived.endedAt } : {}),
      isResume,
    });
  }

  return runs;
}

/** Work root and implementing conversation for the coordinator link on agent runs. */
export function findAgentRunsWorkRoot(
  issueId: string,
  issues: Issue[],
): AgentRunsWorkRoot | undefined {
  const workRootId = nearestImplementingWorkRootId(ancestorChain(issueId, issues));
  if (!workRootId) return undefined;
  const conversationId = activeImplementingConversationId(workRootId);
  if (!conversationId) return undefined;
  return { issueId: workRootId, conversationId };
}

/** List agent runs linked to an issue, oldest spawn first. */
export function listAgentRunsForIssue(issueId: string): AgentRun[] {
  const runs: AgentRun[] = [];

  for (const conversationId of listConversationIds()) {
    let delegations: DelegationRecordWithEnd[];
    try {
      delegations = readDelegations(conversationId);
    } catch {
      continue;
    }

    runs.push(...runsForConversation(conversationId, issueId, delegations));
  }

  runs.push(...reviewTaskerRunsForIssue(issueId));
  runs.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  return runs;
}

function subagentEventsForRun(
  conversationId: string,
  parentCallId: string,
): SubagentUpdateEvent[] {
  const events = readConversation(conversationId).transcript.filter(
    (e): e is SubagentUpdateEvent =>
      e.type === "subagent_update" && e.parentCallId === parentCallId,
  );
  events.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  return events;
}

/** Persisted nested-run events for one linked agent run, in `seq` order. */
export function listAgentRunEvents(
  issueId: string,
  delegationId: string,
): SubagentUpdateEvent[] | undefined {
  const reviewConversationId =
    conversationIdFromReviewTaskerDelegation(delegationId);
  if (reviewConversationId) {
    try {
      const meta = readConversationMeta(reviewConversationId);
      if (meta.issueId === issueId && meta.channel === "review") return [];
    } catch {
      return undefined;
    }
  }

  for (const conversationId of listConversationIds()) {
    let delegations: DelegationRecordWithEnd[];
    try {
      delegations = readDelegations(conversationId);
    } catch {
      continue;
    }

    const record = delegations.find(
      (d) => d.delegationId === delegationId && d.issueId === issueId,
    );
    if (!record?.parentCallId) continue;

    return subagentEventsForRun(conversationId, record.parentCallId);
  }
  return undefined;
}
