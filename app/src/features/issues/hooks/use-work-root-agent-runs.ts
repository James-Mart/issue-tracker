import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  parseConversationFrame,
  type AgentRun,
  type ConversationStreamEvent,
} from "@server/schemas";
import {
  subscribeTopic,
  type TopicMessage,
} from "@/lib/ws/transport";
import { issuesKeys } from "../api/keys";

function conversationTopic(conversationId: string): string {
  return `conversation:${conversationId}`;
}

type ToolCallFrame = Extract<ConversationStreamEvent, { type: "tool_call" }>;

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
    if (event.status === "completed" || event.status === "error") {
      return { ...run, status: event.status, endedAt: event.at };
    }
    return { ...run, status: event.status };
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
  return runs;
}

/**
 * Overlay live work-root conversation frames on the fetched run list:
 * matching `delegation` frames append a run; top-level `tool_call` frames
 * update the run whose `parentCallId` they close.
 */
export function useWorkRootAgentRuns(
  issueId: string,
  conversationId: string | undefined,
  queryRuns: AgentRun[],
): AgentRun[] {
  const qc = useQueryClient();
  const [liveRuns, setLiveRuns] = useState<AgentRun[] | null>(null);
  const queryRunsRef = useRef(queryRuns);
  queryRunsRef.current = queryRuns;

  useEffect(() => {
    setLiveRuns(null);
  }, [issueId, conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    let disposed = false;

    const onTopicMessage = (message: TopicMessage): void => {
      if (disposed) return;
      if (message.type === "reset") {
        setLiveRuns(null);
        void qc.invalidateQueries({
          queryKey: issuesKeys.agentRuns(issueId),
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
      setLiveRuns((prev) =>
        applyFrame(prev ?? queryRunsRef.current, parsed.event, issueId),
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

  return liveRuns ?? queryRuns;
}
