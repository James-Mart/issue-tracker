import type { TranscriptEvent } from "@server/schemas";

/**
 * Scroll key that tracks in-place streaming deltas, not just array length. The
 * keyboard inset joins it so a transcript shortened by the soft keyboard
 * re-lands on the latest messages.
 */
export function transcriptScrollerBottomKey(
  events: TranscriptEvent[],
  pendingMessageText?: string | null,
  keyboardInsetPx = 0,
): string {
  const eventKey = events
    .map((event, index) => {
      switch (event.type) {
        case "assistant":
        case "thinking":
          return `${index}:${event.type}:${event.text.length}:${event.at}`;
        case "tool_call":
          return `${index}:tool:${event.callId}:${event.status}:${event.result?.length ?? 0}`;
        default:
          return `${index}:${event.type}:${event.at}`;
      }
    })
    .join("|");
  const contentKey = pendingMessageText
    ? `${eventKey}|pending:${pendingMessageText.length}:${pendingMessageText}`
    : eventKey;
  return `inset:${keyboardInsetPx}|${contentKey}`;
}
