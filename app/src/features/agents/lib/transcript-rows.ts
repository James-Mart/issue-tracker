import type { TranscriptEvent } from "@server/schemas";

/** Info-line payload when an event renders as a labeled row in the thread body. */
export type TranscriptInfoLine = {
  label: string;
  text: string;
};

/** Map bookkeeping events to labeled thread rows; null means omit from the body. */
export function transcriptInfoLine(
  event: TranscriptEvent,
): TranscriptInfoLine | null {
  switch (event.type) {
    case "usage":
      return null;
    case "status":
      if (!event.message) return null;
      return { label: "Status", text: event.message };
    case "task": {
      const parts = [event.status, event.text].filter(Boolean);
      return {
        label: "Task",
        text: parts.length > 0 ? parts.join(" · ") : "update",
      };
    }
    case "request":
      return { label: "Request", text: event.requestId };
    default:
      return null;
  }
}
