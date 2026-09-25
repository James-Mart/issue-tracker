import type { TranscriptEvent } from "@server/schemas";

function resultLength(result: unknown): number {
  return typeof result === "string" || Array.isArray(result)
    ? result.length
    : 0;
}

/**
 * Scroll key that tracks in-place streaming deltas, not just array length. The
 * keyboard inset joins it so a transcript shortened by the soft keyboard
 * re-lands on the latest messages.
 */
export function transcriptScrollerBottomKey(
  events: TranscriptEvent[],
  pendingMessageText?: string | null,
  keyboardInsetPx = 0,
  steeringText?: string | null,
): string {
  const eventKey = events
    .map((event, index) => {
      switch (event.type) {
        case "assistant":
        case "thinking":
          return `${index}:${event.type}:${event.text.length}:${event.at}`;
        case "tool_call":
          return `${index}:tool:${event.callId}:${event.status}:${resultLength(event.result)}`;
        default:
          return `${index}:${event.type}:${event.at}`;
      }
    })
    .join("|");
  const pendingKey = pendingMessageText
    ? `|pending:${pendingMessageText.length}:${pendingMessageText}`
    : "";
  const steeringKey = steeringText
    ? `|steering:${steeringText.length}:${steeringText}`
    : "";
  return `inset:${keyboardInsetPx}|${eventKey}${pendingKey}${steeringKey}`;
}
