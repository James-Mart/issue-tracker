import type { TranscriptEvent } from "@server/schemas";

/** Scroll key that tracks in-place streaming deltas, not just array length. */
export function transcriptScrollerBottomKey(events: TranscriptEvent[]): string {
  return events
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
}
