import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { TranscriptEvent } from "@server/schemas";
import { subscribeTopic, type TopicMessage } from "@/lib/ws/transport";
import { issuesKeys } from "../api/keys";

const EMPTY_TRANSCRIPT: TranscriptEvent[] = [];

/**
 * Append a live frame without coalescing it. Coalescing here would bake a
 * prefix into the buffer, and the later full-text finalize would concatenate
 * onto that prefix instead of replacing it. `mergeTranscriptDeltas` folds
 * these raw frames onto the seeded transcript.
 */
function appendTranscriptFrame(
  events: TranscriptEvent[],
  event: TranscriptEvent,
): TranscriptEvent[] {
  if (event.seq !== undefined && events.some((existing) => existing.seq === event.seq)) {
    return events;
  }
  return [...events, event];
}

function isResearcherStreamEvent(event: unknown): event is TranscriptEvent {
  if (typeof event !== "object" || event === null) return false;
  const type = (event as { type?: unknown }).type;
  return (
    type === "prompt" ||
    type === "assistant" ||
    type === "thinking" ||
    type === "tool_call"
  );
}

function isRunFinished(event: unknown): boolean {
  return (
    typeof event === "object" &&
    event !== null &&
    (event as { type?: unknown }).type === "run" &&
    (event as { status?: unknown }).status === "finished"
  );
}

/**
 * Live frames on the researcher conversation, after the seeded transcript.
 * Nested runs stream on the work-root conversation; this run is its own.
 */
export function useResearcherTranscriptLive(
  issueId: string,
  delegationId: string,
  conversationId: string,
  enabled: boolean,
  seed: readonly TranscriptEvent[] | undefined,
): TranscriptEvent[] {
  const qc = useQueryClient();
  const [live, setLive] = useState<TranscriptEvent[]>(EMPTY_TRANSCRIPT);
  const held = seed?.at(-1)?.seq;

  useEffect(() => {
    setLive(EMPTY_TRANSCRIPT);
  }, [conversationId]);

  useEffect(() => {
    if (!enabled) return;
    setLive((prev) =>
      held === undefined
        ? prev
        : prev.filter((event) => event.seq === undefined || event.seq > held),
    );
    let disposed = false;
    const unsubscribe = subscribeTopic(
      `conversation:${conversationId}`,
      (message: TopicMessage) => {
        if (disposed) return;
        if (message.type === "reset") {
          setLive(EMPTY_TRANSCRIPT);
          void qc.invalidateQueries({
            queryKey: issuesKeys.agentRunEvents(issueId, delegationId),
          });
          void qc.invalidateQueries({
            queryKey: issuesKeys.agentRuns(issueId),
          });
          return;
        }
        if (isRunFinished(message.event)) {
          void qc.invalidateQueries({
            queryKey: issuesKeys.agentRuns(issueId),
          });
          return;
        }
        if (!isResearcherStreamEvent(message.event)) return;
        const event = message.event;
        setLive((prev) => appendTranscriptFrame(prev, event));
      },
      held,
    );
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [enabled, conversationId, delegationId, held, issueId, qc]);

  return live;
}
