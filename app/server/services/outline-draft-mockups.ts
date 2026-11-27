import { copyFileSync, existsSync, mkdirSync, rmSync } from "fs";
import { basename, join } from "path";
import { attachmentFilenames, attachmentsDir } from "./attachment-paths.js";
import type { OutlineCapture } from "./outline-captures.js";
import { removeOutlineDraftIfUnchanged } from "./outline-draft-store.js";
import {
  backupBundleDirectionId,
  isHeldCaptureName,
  liveBundleName,
} from "./outline-attachments.js";
import { readDraftPredatedDirectionIds } from "./outline-draft-predated.js";

type PublishedCapture = Pick<OutlineCapture, "pngPath">;

/**
 * Put an unpublished draft's backed-up bundles back. The caller holds the
 * issues store lock and the outline's mockup lock. Each backup is written
 * onto its live bundle and removed. Directions the draft added stay on the
 * outline. No predated record means this draft recorded nothing to put back.
 */
export function revertDraftMockups(outlineId: string): void {
  const predated = readDraftPredatedDirectionIds(outlineId);
  if (predated === undefined) return;
  restoreBackups(outlineId);
}

function restoreBackups(outlineId: string): void {
  const dir = attachmentsDir(outlineId);
  for (const name of attachmentFilenames(dir)) {
    const directionId = backupBundleDirectionId(name);
    if (directionId === null) continue;
    const livePath = join(dir, liveBundleName(directionId));
    if (!existsSync(livePath)) {
      throw new Error(
        `outline ${JSON.stringify(outlineId)} has ${name} but no live bundle to restore`,
      );
    }
    copyFileSync(join(dir, name), livePath);
    rmSync(join(dir, name));
  }
}

/**
 * Keep the rewritten bundles: drop every backup, and store `captures` on
 * the outline under their held-capture names. Those names are not
 * directions. The caller holds the issues store lock and the outline's
 * mockup lock. `undefined` means this publish has no mockup bookkeeping.
 */
function finishDraftPublish(
  outlineId: string,
  captures: readonly PublishedCapture[] | undefined,
): void {
  if (captures === undefined) return;
  const dir = attachmentsDir(outlineId);
  mkdirSync(dir, { recursive: true });
  for (const name of attachmentFilenames(dir)) {
    if (backupBundleDirectionId(name) !== null || isHeldCaptureName(name)) {
      rmSync(join(dir, name));
    }
  }
  for (const capture of captures) {
    const name = basename(capture.pngPath);
    if (!isHeldCaptureName(name)) {
      throw new Error(
        `capture ${JSON.stringify(name)} is not a held capture; an outline stores those as mockup-<directionId>-<stateSlug>-<viewport>.png`,
      );
    }
    copyFileSync(capture.pngPath, join(dir, name));
  }
}

/**
 * After the version write has committed: store the captures, drop backups,
 * and drop the draft sidecar when it is still that body.
 */
export function finishPublishedDraft(
  outlineId: string,
  draft: string,
  captures: readonly PublishedCapture[] | undefined,
): void {
  finishDraftPublish(outlineId, captures);
  removeOutlineDraftIfUnchanged(outlineId, draft);
}
