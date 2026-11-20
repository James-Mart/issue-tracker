export const OUTLINE_SESSION_ROLES = [
  "planner",
  "decomposer",
  "reconcile",
  "check",
] as const;

export type OutlineSessionRole = (typeof OUTLINE_SESSION_ROLES)[number];

const OUTLINE_ROLE_CHANNELS = {
  planner: "planning",
  decomposer: "decomposition",
  reconcile: "decomposition",
  check: "decomposition",
} as const satisfies Record<OutlineSessionRole, "planning" | "decomposition">;

/** Channel an outline session of this role runs on. */
export function outlineChannelForRole(
  role: OutlineSessionRole,
): "planning" | "decomposition" {
  return OUTLINE_ROLE_CHANNELS[role];
}
