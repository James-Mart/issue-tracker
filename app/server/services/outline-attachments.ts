import { mkdirSync, renameSync } from "fs";
import { join } from "path";
import { assertSlug, SLUG_PATTERN as SLUG } from "../slug.js";
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

export function backupBundleName(directionId: string): string {
  return `mockup-${directionId}.backup.tar.gz`;
}

/** The live-bundle basename for a direction id, or a refusal when it is not a slug. */
export function requireLiveBundleName(directionId: string): string {
  assertSlug(directionId, "direction id");
  return liveBundleName(directionId);
}

/** The direction a live bundle name carries, or null for any other name. */
export function liveBundleDirectionId(name: string): string | null {
  return LIVE_BUNDLE_RE.exec(name)?.[1] ?? null;
}

/** Direction ids of the live replay bundles attached to `outlineId`. */
export function liveReplayDirectionIds(outlineId: string): string[] {
  return attachmentFilenames(attachmentsDir(outlineId)).flatMap((name) => {
    const directionId = liveBundleDirectionId(name);
    return directionId === null ? [] : [directionId];
  });
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

function moveNamedReplayBundles(
  ideaId: string,
  outlineId: string,
  names: readonly string[],
): string[] {
  if (names.length === 0) return [];
  const outlineDir = attachmentsDir(outlineId);
  mkdirSync(outlineDir, { recursive: true });
  const ideaDir = attachmentsDir(ideaId);
  for (const name of names) {
    renameSync(join(ideaDir, name), join(outlineDir, name));
  }
  return [...names];
}

function liveBundleNames(ideaId: string): string[] {
  return attachmentFilenames(attachmentsDir(ideaId)).filter(
    (name) => liveBundleDirectionId(name) !== null,
  );
}

/**
 * Move every live replay bundle from the Idea onto the outline at the same
 * basename; captures and anything else stay on the Idea. The caller holds
 * the store lock and has just created the outline, so no name is taken.
 */
export function moveReplayBundlesFromIdea(ideaId: string, outlineId: string): string[] {
  return moveNamedReplayBundles(ideaId, outlineId, liveBundleNames(ideaId));
}

/**
 * Move live bundles the outline does not already hold, at the same basename.
 * A name already on the outline is left on both sides, so a direction that
 * predated the draft is not replaced by the Idea's copy.
 */
export function moveNewReplayBundlesFromIdea(ideaId: string, outlineId: string): string[] {
  const taken = new Set(attachmentFilenames(attachmentsDir(outlineId)));
  return moveNamedReplayBundles(
    ideaId,
    outlineId,
    liveBundleNames(ideaId).filter((name) => !taken.has(name)),
  );
}
