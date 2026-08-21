/** Decoration the channel tab may show — never both at once. */
export type ChannelTabIndicator = "active-run" | "awaiting-human";

/**
 * Channel tab decoration from the session the panel already renders.
 *
 * Active run wins (pulsing dot). When idle, warn when the session list marks
 * awaiting human. No session → neither.
 */
export function channelTabIndicator(
  hasSession: boolean,
  activeRun: boolean,
  awaitingHuman: boolean,
): ChannelTabIndicator | null {
  if (!hasSession) return null;
  if (activeRun) return "active-run";
  return awaitingHuman ? "awaiting-human" : null;
}
