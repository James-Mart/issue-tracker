import type { TranscriptEvent } from "@server/schemas";

/** Decoration the channel tab may show — never both at once. */
export type ChannelTabIndicator = "active-run" | "awaiting-human";

/**
 * Turn-boundary events: a human prompt vs an agent-completed turn (reply or
 * error). Intermediate frames (thinking, tools, usage) do not clear or set
 * the waiting accent on their own.
 */
function isTurnBoundary(
  event: TranscriptEvent,
): event is Extract<TranscriptEvent, { type: "prompt" | "assistant" | "error" }> {
  return (
    event.type === "prompt" ||
    event.type === "assistant" ||
    event.type === "error"
  );
}

/**
 * Channel tab decoration from the session the panel already renders.
 *
 * Active run wins (pulsing dot). When idle, warn when the last turn-boundary
 * is agent-side — grill question, errored run, or finished work waiting to be
 * read. A trailing human prompt clears the accent. No session → neither.
 */
export function channelTabIndicator(
  hasSession: boolean,
  runActive: boolean,
  events: readonly TranscriptEvent[],
): ChannelTabIndicator | null {
  if (!hasSession) return null;
  if (runActive) return "active-run";

  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (!isTurnBoundary(event)) continue;
    if (event.type === "prompt") return null;
    return "awaiting-human";
  }
  return null;
}
