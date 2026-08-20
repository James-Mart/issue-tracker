import type { AgentRun, DelegationRecord, Issue, TranscriptEvent } from "../schemas.js";
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

type ToolCallEvent = Extract<TranscriptEvent, { type: "tool_call" }>;

function deriveRunStatus(
  parentCallId: string,
  toolCalls: ToolCallEvent[],
): { status: AgentRun["status"]; endedAt?: string } | undefined {
  const matching = toolCalls.filter((e) => e.callId === parentCallId);
  if (matching.length === 0) return undefined;

  for (let i = matching.length - 1; i >= 0; i -= 1) {
    const row = matching[i]!;
    if (row.status === "completed" || row.status === "error") {
      return { status: row.status, endedAt: row.at };
    }
  }

  if (matching.some((e) => e.status === "running")) {
    return { status: "running" };
  }

  return undefined;
}

function runsForConversation(
  conversationId: string,
  issueId: string,
  delegations: DelegationRecord[],
  toolCalls: ToolCallEvent[],
): AgentRun[] {
  const runs: AgentRun[] = [];
  const seenAgentIds = new Set<string>();

  for (const record of delegations) {
    if (record.issueId !== issueId || !record.parentCallId) continue;

    const derived = deriveRunStatus(record.parentCallId, toolCalls);
    if (!derived) continue;

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
    let delegations: DelegationRecord[];
    let toolCalls: ToolCallEvent[];
    try {
      delegations = readDelegations(conversationId);
      toolCalls = readConversation(conversationId).transcript.filter(
        (e): e is ToolCallEvent => e.type === "tool_call",
      );
    } catch {
      continue;
    }

    runs.push(
      ...runsForConversation(conversationId, issueId, delegations, toolCalls),
    );
  }

  runs.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  return runs;
}
