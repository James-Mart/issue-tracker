import type { NestedStep, TranscriptEvent } from "@server/schemas";
import { foldTranscriptEvents } from "@/features/agents/lib/conversation-events-state";

/**
 * Assistant messages, thinking, and tool calls from a researcher transcript.
 * Prompts stay in the fold so a later message does not merge into an earlier
 * one; the role prompt is not a row in the card.
 */
export function researcherTranscriptDisplaySteps(
  events: readonly TranscriptEvent[],
): NestedStep[] {
  const steps: NestedStep[] = [];
  for (const event of foldTranscriptEvents(events)) {
    if (event.type === "assistant") {
      if (event.text.length === 0) continue;
      steps.push({ kind: "text", text: event.text });
    } else if (event.type === "thinking") {
      steps.push({ kind: "thinking", text: event.text });
    } else if (event.type === "tool_call") {
      steps.push({
        kind: "tool_call",
        callId: event.callId,
        status: event.status,
        ...(event.name !== undefined ? { name: event.name } : {}),
        ...(event.args !== undefined ? { args: event.args } : {}),
        ...(event.result !== undefined ? { result: event.result } : {}),
      });
    }
  }
  return steps;
}
