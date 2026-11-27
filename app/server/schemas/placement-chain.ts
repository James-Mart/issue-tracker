import { z } from "zod";
import {
  PLACEMENT_ACTIONS,
  PLACEMENT_STEPS,
  type PlacementAction,
  type PlacementStep,
} from "../../src/features/issues/lib/placement-actions.js";

export { PLACEMENT_ACTIONS };
export type { PlacementAction, PlacementStep };

const nonEmpty = z.string().min(1);

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
