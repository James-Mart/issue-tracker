import { z } from "zod";

const nonEmpty = z.string().min(1);

export const PLACEMENT_ACTIONS = ["update", "reconcile"] as const;
export const PLACEMENT_STEPS = ["decomposer", "reconciler", "polish"] as const;

/**
 * One in-progress placement on an outline. `version` is the outline
 * `bodyVersion` when the chain started; a later save does not move it.
 */
export const placementChainSchema = z
  .object({
    root: nonEmpty,
    action: z.enum(PLACEMENT_ACTIONS),
    from: z.number().int().positive(),
    version: z.number().int().positive(),
    step: z.enum(PLACEMENT_STEPS),
  })
  .strict();

export type PlacementChain = z.infer<typeof placementChainSchema>;
export type PlacementAction = PlacementChain["action"];
export type PlacementStep = PlacementChain["step"];
