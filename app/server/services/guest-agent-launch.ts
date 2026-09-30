import { trackerGuest } from "../config.js";
import { IssueError } from "./errors.js";

export const GUEST_REFUSED_CONVERSATION_PROMPT =
  "guest refused to start a conversation prompt";
export const GUEST_REFUSED_CONVERSATION_MESSAGE =
  "guest refused to send a conversation message";
export const GUEST_REFUSED_FORK = "guest refused to fork a conversation";
export const GUEST_REFUSED_CHANNEL_SESSION =
  "guest refused to start an issue-channel session";
export const GUEST_REFUSED_DELEGATE = "guest refused to delegate";
export const GUEST_REFUSED_START_AGENT = "guest refused to start an agent";
export const GUEST_REFUSED_RESUME_AGENT = "guest refused to resume an agent";
export const GUEST_REFUSED_PREWARM = "guest refused to prewarm a workspace";

/** Guest off continues. Guest on refuses agent and SDK launches. */
export function guestRefusesAgentLaunch(): boolean {
  return trackerGuest;
}

/**
 * Throw before a conversation write or SDK call. HTTP surfaces this as 403
 * `{ error: what, code: "guest" }` through the usual error handler.
 */
export function assertGuestAllowsAgentLaunch(what: string): void {
  if (guestRefusesAgentLaunch()) {
    throw new IssueError("guest", what);
  }
}
