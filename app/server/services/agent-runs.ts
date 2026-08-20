import type { AgentRun, DelegationRecord, TranscriptEvent } from "../schemas.js";
import { readConversation, readDelegations, listConversationIds } from "./conversations.js";

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
