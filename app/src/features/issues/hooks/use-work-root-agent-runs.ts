import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  parseConversationFrame,
  type AgentRun,
  type ConversationStreamEvent,
  type TranscriptEvent,
} from "@server/schemas";
import { applyTranscriptDelta } from "@/features/agents/lib/conversation-events-state";
import {
  subscribeTopic,
  type TopicMessage,
} from "@/lib/ws/transport";
import { issuesKeys } from "../api/keys";

function conversationTopic(conversationId: string): string {
  return `conversation:${conversationId}`;
}

type ToolCallFrame = Extract<ConversationStreamEvent, { type: "tool_call" }>;
type DelegationEndFrame = Extract<
  ConversationStreamEvent,
  { type: "delegation_end" }
>;
type SubagentUpdateEvent = Extract<
  TranscriptEvent,
  { type: "subagent_update" }
>;

export type LiveEventsByParentCallId = Record<string, SubagentUpdateEvent[]>;

const EMPTY_LIVE_EVENTS_BY_PARENT: LiveEventsByParentCallId = {};

export function appendIssueRun(runs: AgentRun[], run: AgentRun): AgentRun[] {
  if (runs.some((existing) => existing.delegationId === run.delegationId)) {
    return runs;
  }
  return [...runs, run].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

export function applyParentToolCall(
  runs: AgentRun[],
  event: ToolCallFrame,
): AgentRun[] {
  return runs.map((run) => {
    if (run.parentCallId !== event.callId) return run;
    if (event.status === "completed" || event.status === "error") return run;
    return { ...run, status: event.status };
  });
}

export function applyDelegationEnd(
  runs: AgentRun[],
  event: DelegationEndFrame,
): AgentRun[] {
  return runs.map((run) => {
    if (run.parentCallId !== event.parentCallId) return run;
    return { ...run, status: event.status, endedAt: event.endedAt };
  });
}

function applyFrame(
  runs: AgentRun[],
  event: ConversationStreamEvent,
  issueId: string,
): AgentRun[] {
  if (event.type === "delegation") {
    if (event.run.issueId !== issueId) return runs;
    return appendIssueRun(runs, event.run);
  }
  if (event.type === "tool_call") {
    return applyParentToolCall(runs, event);
  }
  if (event.type === "delegation_end") {
    return applyDelegationEnd(runs, event);
  }
  return runs;
}

/** Fold one live `subagent_update` into the overlay for its `parentCallId`, in `seq` order. */
export function appendLiveSubagentUpdate(
  byParent: LiveEventsByParentCallId,
  event: SubagentUpdateEvent,
): LiveEventsByParentCallId {
  const existing = byParent[event.parentCallId] ?? [];
  const next = applyTranscriptDelta(existing, event) as SubagentUpdateEvent[];
  if (next === existing) return byParent;
  return { ...byParent, [event.parentCallId]: next };
}

export type WorkRootAgentRuns = {
  runs: AgentRun[];
  liveEventsByParentCallId: LiveEventsByParentCallId;
};

/**
 * Overlay live work-root conversation frames on the fetched run list:
 * matching `delegation` frames append a run; `delegation_end` frames update
 * the run whose `parentCallId` they close; non-terminal `tool_call` frames
 * update in-flight status; `subagent_update` frames fold into that run's
 * live event overlay in `seq` order.
 */
export function useWorkRootAgentRuns(
  issueId: string,
  conversationId: string | undefined,
  queryRuns: AgentRun[],
): WorkRootAgentRuns {
  const qc = useQueryClient();
  const [liveRuns, setLiveRuns] = useState<AgentRun[] | null>(null);
  const [liveEventsByParentCallId, setLiveEventsByParentCallId] =
    useState<LiveEventsByParentCallId>(EMPTY_LIVE_EVENTS_BY_PARENT);
  const queryRunsRef = useRef(queryRuns);
  queryRunsRef.current = queryRuns;

  useEffect(() => {
    setLiveRuns(null);
    setLiveEventsByParentCallId(EMPTY_LIVE_EVENTS_BY_PARENT);
  }, [issueId, conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    let disposed = false;

    const onTopicMessage = (message: TopicMessage): void => {
      if (disposed) return;
      if (message.type === "reset") {
        setLiveRuns(null);
        setLiveEventsByParentCallId(EMPTY_LIVE_EVENTS_BY_PARENT);
        void qc.invalidateQueries({
          queryKey: issuesKeys.agentRuns(issueId),
        });
        void qc.invalidateQueries({
          queryKey: [...issuesKeys.all, "agentRunEvents", issueId],
        });
        return;
      }
      const parsed = parseConversationFrame(message.event);
      if (!parsed.ok) {
        if (import.meta.env.DEV) {
          console.warn(
            "ignoring malformed conversation event:",
            message.event,
            parsed.message,
          );
        }
        return;
      }
      const { event } = parsed;
      if (event.type === "subagent_update") {
        setLiveEventsByParentCallId((prev) =>
          appendLiveSubagentUpdate(prev, event),
        );
      }
      setLiveRuns((prev) =>
        applyFrame(prev ?? queryRunsRef.current, event, issueId),
      );
    };

    const unsubscribe = subscribeTopic(
      conversationTopic(conversationId),
      onTopicMessage,
    );
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [conversationId, issueId, qc]);

  return {
    runs: liveRuns ?? queryRuns,
    liveEventsByParentCallId,
  };
}
