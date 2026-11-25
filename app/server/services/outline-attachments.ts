import { mkdirSync, renameSync } from "fs";
import { join } from "path";
import { SLUG_PATTERN as SLUG } from "../slug.js";
import { attachmentFilenames, attachmentsDir } from "./attachment-paths.js";
import { IssueError } from "./errors.js";

/**
 * An outline holds three attachment shapes and refuses every other name:
 * a live replay bundle per accepted direction, a hidden backup of one, and a
 * held capture PNG. Only live bundles are directions.
 */

const LIVE_BUNDLE_RE = new RegExp(`^mockup-(${SLUG})\\.tar\\.gz$`);
const BACKUP_BUNDLE_RE = new RegExp(`^mockup-(${SLUG})\\.backup\\.tar\\.gz$`);
const HELD_CAPTURE_RE = new RegExp(`^mockup-${SLUG}-(phone|desktop)\\.png$`);

export function liveBundleName(directionId: string): string {
  return `mockup-${directionId}.tar.gz`;
}

/** The direction a live bundle name carries, or null for any other name. */
export function liveBundleDirectionId(name: string): string | null {
  return LIVE_BUNDLE_RE.exec(name)?.[1] ?? null;
}

export function isOutlineAttachmentName(name: string): boolean {
  return (
    LIVE_BUNDLE_RE.test(name) ||
    BACKUP_BUNDLE_RE.test(name) ||
    HELD_CAPTURE_RE.test(name)
  );
}

export function assertOutlineAttachmentName(name: string): void {
  if (isOutlineAttachmentName(name)) return;
  throw new IssueError(
    "validation",
    `attachment "${name}" is not allowed on an Outline; an Outline holds only ` +
      "mockup-<directionId>.tar.gz, mockup-<directionId>.backup.tar.gz, and " +
      "mockup-<directionId>-<stateSlug>-<viewport>.png",
  );
}

/**
 * Move every live replay bundle from the Idea onto the outline at the same
 * basename; captures and anything else stay on the Idea. The caller holds
 * the store lock and has just created the outline, so no name is taken.
 */
export function moveReplayBundlesFromIdea(ideaId: string, outlineId: string): string[] {
  const moved = attachmentFilenames(attachmentsDir(ideaId)).filter((name) => liveBundleDirectionId(name) !== null);
  if (moved.length === 0) return moved;
  mkdirSync(attachmentsDir(outlineId), { recursive: true });
  for (const name of moved) {
    renameSync(join(attachmentsDir(ideaId), name), join(attachmentsDir(outlineId), name));
  }
  return moved;
}
