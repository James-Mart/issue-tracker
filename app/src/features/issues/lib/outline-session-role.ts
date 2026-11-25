export const OUTLINE_SESSION_ROLES = [
  "planner",
  "decomposer",
  "reconcile",
  "check",
  "mockup-author",
] as const;

export type OutlineSessionRole = (typeof OUTLINE_SESSION_ROLES)[number];

/** Channels an outline offers. One live run is allowed across all of them. */
export const OUTLINE_CHANNELS = ["planning", "decomposition", "mockups"] as const;

export type OutlineChannel = (typeof OUTLINE_CHANNELS)[number];

export function isOutlineChannel(channel: string): channel is OutlineChannel {
  return (OUTLINE_CHANNELS as readonly string[]).includes(channel);
}

const OUTLINE_ROLE_CHANNELS = {
  planner: "planning",
  decomposer: "decomposition",
  reconcile: "decomposition",
  check: "decomposition",
  "mockup-author": "mockups",
} as const satisfies Record<OutlineSessionRole, OutlineChannel>;

/** Channel an outline session of this role runs on. */
export function outlineChannelForRole(role: OutlineSessionRole): OutlineChannel {
  return OUTLINE_ROLE_CHANNELS[role];
}

/**
 * The other of the Planning and Decomposition tabs' channels. A live run on
 * `mockups` holds the same outline lock but is not paired with either tab.
 */
export function otherOutlineChannel(
  channel: "planning" | "decomposition",
): "planning" | "decomposition" {
  return channel === "planning" ? "decomposition" : "planning";
}
