import { existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { z } from "zod";
import { issuesDir } from "../config.js";
import { replaceFileAtomically } from "./issues-store-lock.js";

const predatedSchema = z
  .object({
    predated: z.array(z.string()),
  })
  .strict();

function predatedPath(outlineId: string): string {
  return join(issuesDir, outlineId, "draft-predated.json");
}

/**
 * Direction ids that were live on the outline before this unpublished draft
 * added any. Absent when that set has not been recorded. Removed with the
 * draft sidecar — read it before that removal when the set is still needed.
 */
export function readDraftPredatedDirectionIds(outlineId: string): string[] | undefined {
  const path = predatedPath(outlineId);
  if (!existsSync(path)) return undefined;
  const parsed = predatedSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) {
    throw new Error(`invalid draft predated record at ${path}: ${parsed.error.message}`);
  }
  return parsed.data.predated;
}

/** Record `directionIds` when this draft has no predated set yet, and return the set that stands. */
export function recordDraftPredatedDirectionIdsOnce(
  outlineId: string,
  directionIds: readonly string[],
): string[] {
  const stored = readDraftPredatedDirectionIds(outlineId);
  if (stored) return stored;
  const predated = [...directionIds];
  writeDraftPredatedDirectionIds(outlineId, predated);
  return predated;
}

function writeDraftPredatedDirectionIds(
  outlineId: string,
  directionIds: readonly string[],
): void {
  replaceFileAtomically(
    predatedPath(outlineId),
    `${JSON.stringify({ predated: [...directionIds] })}\n`,
  );
}

export function removeDraftPredatedDirectionIds(outlineId: string): void {
  rmSync(predatedPath(outlineId), { force: true });
}
