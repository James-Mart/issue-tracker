import type { TranscriptEvent } from "@server/schemas";
import { awaitingHumanFromTranscript } from "@server/services/awaiting-human";

/** Decoration the channel tab may show — never both at once. */
export type ChannelTabIndicator = "active-run" | "awaiting-human";

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
  return awaitingHumanFromTranscript(events) ? "awaiting-human" : null;
}
