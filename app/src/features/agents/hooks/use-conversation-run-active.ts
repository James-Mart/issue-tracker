import { useEffect, useState } from "react";
import type { TranscriptEvent } from "@server/schemas";

/** Idle window after the last post-prompt stream frame before treating the run as done. */
const RUN_IDLE_MS = 750;

/** True while any tool call is still in flight in the live transcript. */
export function hasRunningToolCall(events: TranscriptEvent[]): boolean {
  return events.some(
    (event) => event.type === "tool_call" && event.status === "running",
  );
}

/**
 * Whether the open conversation has an in-flight agent run.
 *
 * Combines a local latch (set on successful send, cleared on cancel or stream
 * idle) with running `tool_call` frames from the live transcript. The server
 * does not emit a terminal status frame, so post-send idle is inferred from a
 * quiet period after events advance past the send-time baseline.
 */
export function useConversationRunActive(
  conversationId: string,
  events: TranscriptEvent[],
): {
  runActive: boolean;
  markRunStarted: (baselineEventCount: number) => void;
  markRunStopped: () => void;
} {
  const [awaitingRun, setAwaitingRun] = useState(false);
  const [baselineCount, setBaselineCount] = useState(0);

  useEffect(() => {
    setAwaitingRun(false);
    setBaselineCount(0);
  }, [conversationId]);

  const toolsRunning = hasRunningToolCall(events);

  useEffect(() => {
    if (!awaitingRun) return;
    if (toolsRunning) return;
    if (events.length <= baselineCount) return;
    const timer = setTimeout(() => setAwaitingRun(false), RUN_IDLE_MS);
    return () => clearTimeout(timer);
  }, [awaitingRun, toolsRunning, events, baselineCount]);

  return {
    runActive: awaitingRun || toolsRunning,
    markRunStarted: (baselineEventCount: number) => {
      setBaselineCount(baselineEventCount);
      setAwaitingRun(true);
    },
    markRunStopped: () => setAwaitingRun(false),
  };
}
