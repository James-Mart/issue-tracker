import { renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chosenAttachmentName, stateSlug } from "./mockup-promote.js";
import { captureStoryStates, type ViewportName } from "./mockup-story-capture.js";
import { listStoryStates } from "./mockup-story-states.js";
import {
  outlineCapturesDir,
  outlineMockupsRoot,
  readAuthorRunState,
} from "./outline-mockup-store.js";
import { listAcceptedDirections, restoreOutlineTree } from "./outline-replay-tree.js";
import { acquireCaptureLease, releaseLease } from "./outline-storybook.js";

export interface OutlineCapture {
  directionId: string;
  stateSlug: string;
  viewport: ViewportName;
  /** Named `mockup-<directionId>-<stateSlug>-<viewport>.png`, ready to attach. */
  pngPath: string;
}

const VIEWPORTS: ViewportName[] = ["phone", "desktop"];

/**
 * Capture phone and desktop PNGs of every story state in every accepted
 * direction, under a capture lease. `fromPack` restores the packed bundles
 * first, dropping a failed edit; without it a failed author run is refused
 * and its tree is left alone. The previous run's PNGs are replaced only when
 * every capture succeeds.
 */
export async function captureOutlineDirections(
  outlineId: string,
  options: { fromPack?: boolean } = {},
): Promise<OutlineCapture[]> {
  if (options.fromPack) {
    await restoreOutlineTree(outlineId);
  } else if (readAuthorRunState(outlineId) === "failed") {
    throw new Error(
      `outline ${JSON.stringify(outlineId)}: the last mockup author run failed without packing; its replay tree is left as it was and no capture was written`,
    );
  }
  const directionIds = listAcceptedDirections(outlineId).map((entry) => entry.directionId);
  if (directionIds.length === 0) {
    throw new Error(`outline ${JSON.stringify(outlineId)} has no accepted directions to capture`);
  }

  const { leaseId, baseUrl } = await acquireCaptureLease(outlineId);
  const staging = join(outlineMockupsRoot(outlineId), `captures.${leaseId}`);
  try {
    const captures: OutlineCapture[] = [];
    for (const directionId of directionIds) {
      const results = await captureStoryStates({
        baseUrl,
        outDir: join(staging, directionId),
        states: await listStoryStates(baseUrl, directionId),
        viewports: VIEWPORTS,
      });
      for (const result of results) {
        const name = chosenAttachmentName(directionId, result.storyId, result.viewport);
        renameSync(result.absolutePath, join(staging, name));
        captures.push({
          directionId,
          stateSlug: stateSlug(result.storyId, directionId),
          viewport: result.viewport,
          pngPath: join(outlineCapturesDir(outlineId), name),
        });
      }
      rmSync(join(staging, directionId), { recursive: true, force: true });
    }
    rmSync(outlineCapturesDir(outlineId), { recursive: true, force: true });
    renameSync(staging, outlineCapturesDir(outlineId));
    return captures;
  } finally {
    rmSync(staging, { recursive: true, force: true });
    await releaseLease(leaseId);
  }
}
