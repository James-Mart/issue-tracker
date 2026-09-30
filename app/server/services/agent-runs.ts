import type {
  AgentRun,
  DelegationRecordWithEnd,
  Issue,
  TranscriptEvent,
} from "../schemas.js";
import {
  activeImplementingConversationId,
  listConversationIds,
  readDelegations,
} from "./conversations.js";
import { resolveDelegation } from "./delegation-index.js";
import { readRunEvents } from "./run-event-log.js";
import {
  conversationIdFromResearcherDelegation,
  researcherConversationIds,
  researcherRunsForIssue,
} from "./researcher-runs.js";
import {
  conversationIdFromReviewTaskerDelegation,
  reviewTaskerConversationIds,
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
  runs.push(...researcherRunsForIssue(issueId));
  runs.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  return runs;
}

/** Persisted nested-run events for one linked agent run, in `seq` order. */
export function listAgentRunEvents(
  issueId: string,
  delegationId: string,
): SubagentUpdateEvent[] | undefined {
  const taskerConversationId =
    conversationIdFromReviewTaskerDelegation(delegationId);
  if (taskerConversationId) {
    return reviewTaskerConversationIds(issueId).includes(taskerConversationId)
      ? []
      : undefined;
  }

  const researcherConversationId =
    conversationIdFromResearcherDelegation(delegationId);
  if (researcherConversationId) {
    return researcherConversationIds(issueId).includes(researcherConversationId)
      ? []
      : undefined;
  }

  const located = resolveDelegation(delegationId);
  if (!located || located.issueId !== issueId) return undefined;
  return readRunEvents(located.conversationId, located.parentCallId);
}
