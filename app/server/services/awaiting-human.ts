import type { TranscriptEvent } from "../schemas.js";

function isTurnBoundary(
  event: TranscriptEvent,
): event is Extract<
  TranscriptEvent,
  { type: "prompt" | "assistant" | "error" }
> {
  return (
    event.type === "prompt" ||
    event.type === "assistant" ||
    event.type === "error"
  );
}

/**
 * Whether an idle session's last turn-boundary is agent-side (assistant reply
 * or error). Trailing human prompt → false; no boundary events → false.
 */
export function awaitingHumanFromTranscript(
  events: readonly TranscriptEvent[],
): boolean {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (!isTurnBoundary(event)) continue;
    if (event.type === "prompt") return false;
    return true;
  }
  return false;
}
