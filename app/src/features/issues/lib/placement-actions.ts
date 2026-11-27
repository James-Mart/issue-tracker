import type { OutlineSessionRole } from "./outline-session-role";

/** Per-root actions on a behind open linked root. */
export const PLACEMENT_ACTIONS = ["update", "reconcile"] as const;

export type PlacementAction = (typeof PLACEMENT_ACTIONS)[number];

/** Steps of a placement chain; each runs as the outline session role of that name. */
export const PLACEMENT_STEPS = [
  "decomposer",
  "reconciler",
  "polish",
] as const satisfies readonly OutlineSessionRole[];

export type PlacementStep = (typeof PLACEMENT_STEPS)[number];

/** The step each action's chain starts at. */
export const PLACEMENT_FIRST_STEP = {
  update: "decomposer",
  reconcile: "reconciler",
} as const satisfies Record<PlacementAction, PlacementStep>;
