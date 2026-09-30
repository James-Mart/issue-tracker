import type { TranscriptEvent, TranscriptEventInput } from "../schemas.js";

/** Turn-boundary append rule: prompt → false, assistant/error → true. */
export function awaitingHumanAfterTurnBoundary(
  type: TranscriptEventInput["type"],
): boolean | undefined {
  if (type === "prompt") return false;
  if (type === "assistant" || type === "error") return true;
  return undefined;
}

/**
 * Whether an idle session's last turn-boundary is agent-side (assistant reply
 * or error). Trailing human prompt → false; no boundary events → false.
 */
export function awaitingHumanFromTranscript(
  events: readonly TranscriptEvent[],
): boolean {
  for (let i = events.length - 1; i >= 0; i--) {
    const value = awaitingHumanAfterTurnBoundary(events[i]!.type);
    if (value !== undefined) return value;
  }
  return false;
}
