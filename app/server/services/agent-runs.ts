import type {
  AgentRun,
  DelegationRecordWithEnd,
  Issue,
  TranscriptEvent,
} from "../schemas.js";
import {
  listConversations,
  readConversation,
  readDelegations,
  listConversationIds,
} from "./conversations.js";
import { ancestorChain } from "./subtree.js";

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

function nearestImplementingWorkRootId(chain: Issue[]): string | undefined {
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const issue = chain[i]!;
    if (issue.kind === "epic") return issue.id;
    if (issue.kind === "story" && chain[i - 1]?.kind === "project") {
      return issue.id;
    }
  }
  return undefined;
}

function findCoordinatorConversation(workRootId: string): string | undefined {
  for (const meta of listConversations()) {
    if (
      meta.archived ||
      meta.issueId !== workRootId ||
      meta.channel !== "implementing"
    ) {
      continue;
    }
    return meta.id;
  }
  return undefined;
}

/** Work root and implementing conversation for the coordinator link on agent runs. */
export function findAgentRunsWorkRoot(
  issueId: string,
  issues: Issue[],
): AgentRunsWorkRoot | undefined {
  const workRootId = nearestImplementingWorkRootId(ancestorChain(issueId, issues));
  if (!workRootId) return undefined;
  const conversationId = findCoordinatorConversation(workRootId);
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
