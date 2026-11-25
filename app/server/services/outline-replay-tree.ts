import { execFile } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  MAX_ATTACHMENT_BYTES,
  attachmentPath,
  listAttachments,
  putAttachment,
  removeOutlineAttachment,
  replaceAttachment,
  replaceOutlineAttachment,
} from "./attachments.js";
import { readOutlineOrThrow } from "./issues.js";
import { mockupScratchDir, sandboxNpmCacheDir } from "./mockup-scratch.js";
import { liveBundleDirectionId, liveBundleName, requireLiveBundleName } from "./outline-attachments.js";
import {
  readAuthorRunState,
  replayTreeDir,
  withOutlineMockupsLock,
  writeAuthorRunState,
  type AuthorRunState,
} from "./outline-mockup-store.js";
import { packReplayBundle, unpackReplayBundles } from "./replay-bundle.js";
import { tailLines } from "./storybook-process.js";

const execFileAsync = promisify(execFile);

/** An install or Storybook start that failed: the command and the end of its output. */
export class MockupCommandFailure extends Error {
  constructor(
    readonly command: string,
    readonly outputTail: string,
  ) {
    super(outputTail ? `${command} failed:\n${outputTail}` : `${command} failed`);
    this.name = "MockupCommandFailure";
  }
}

function liveDirectionIds(outlineId: string): string[] {
  return listAttachments(outlineId)
    .map((attachment) => liveBundleDirectionId(attachment.name))
    .filter((directionId) => directionId !== null);
}

/** The outline's live replay bundles, one per accepted direction. */
export function listAcceptedDirections(outlineId: string): { directionId: string }[] {
  readOutlineOrThrow(outlineId);
  return liveDirectionIds(outlineId).map((directionId) => ({ directionId }));
}

function assertReplayBundleWithinLimit(name: string, bytes: Uint8Array): void {
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `replay bundle ${name} exceeds the ${MAX_ATTACHMENT_BYTES} byte attachment limit`,
    );
  }
}

function acceptedDirectionIds(outlineId: string): string[] {
  const directionIds = liveDirectionIds(outlineId);
  if (directionIds.length === 0) {
    throw new Error(`outline ${JSON.stringify(outlineId)} has no replay bundles`);
  }
  return directionIds;
}

/** Install the tree's manifest; every start and restore runs this so new dependencies land. */
async function installReplayTree(outlineId: string): Promise<void> {
  const tree = replayTreeDir(outlineId);
  const args = ["install", "--ignore-scripts", "--cache", sandboxNpmCacheDir(tree)];
  try {
    await execFileAsync("npm", args, {
      cwd: tree,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err) {
    const { stdout = "", stderr = "" } = err as { stdout?: string; stderr?: string };
    throw new MockupCommandFailure(`npm ${args.join(" ")}`, tailLines(`${stdout}${stderr}`));
  }
}

/**
 * Restore for a caller already holding the outline's lock. Refused while the
 * author is editing the tree. The restored tree matches the bundles, so the
 * author run reads clean from here, even when the install that follows fails.
 */
async function restoreTreeFromBundles(outlineId: string): Promise<string[]> {
  if (readAuthorRunState(outlineId) === "running") {
    throw new Error(
      `outline ${JSON.stringify(outlineId)}: the mockup author is editing its replay tree, and a restore would overwrite that run`,
    );
  }
  const directionIds = acceptedDirectionIds(outlineId);
  unpackReplayBundles(
    replayTreeDir(outlineId),
    directionIds.map((directionId) => ({
      directionId,
      path: attachmentPath(outlineId, liveBundleName(directionId)),
    })),
  );
  writeAuthorRunState(outlineId, "clean");
  await installReplayTree(outlineId);
  return directionIds;
}

/**
 * How a serve should ready the tree, from an author-run record already read.
 * `restore` rebuilds a clean tree from its bundles. `install` keeps the tree
 * a running or failed author left on disk.
 */
export function replayTreeServePlan(
  authorRun: AuthorRunState,
  directionCount: number,
  hasHarness: boolean,
): "restore" | "install" | "none" {
  if (authorRun === "clean" && directionCount > 0) return "restore";
  if (hasHarness) return "install";
  return "none";
}

/** Ready the tree for a Storybook start. The caller holds the outline's lock. */
export async function prepareReplayTreeForServe(outlineId: string): Promise<void> {
  const plan = replayTreeServePlan(
    readAuthorRunState(outlineId),
    liveDirectionIds(outlineId).length,
    existsSync(join(replayTreeDir(outlineId), "harness.json")),
  );
  if (plan === "restore") {
    await restoreTreeFromBundles(outlineId);
    return;
  }
  if (plan === "install") {
    await installReplayTree(outlineId);
    return;
  }
  throw new Error(`outline ${JSON.stringify(outlineId)} has no mockups to serve`);
}

/**
 * Replace each accepted direction's stories in the replay tree, plus the
 * shared `harness.json` and `package.json`, then install. A running
 * Storybook picks the new stories up in place.
 */
export function restoreOutlineTree(outlineId: string): Promise<{ directionIds: string[] }> {
  readOutlineOrThrow(outlineId);
  return withOutlineMockupsLock(outlineId, async () => ({
    directionIds: await restoreTreeFromBundles(outlineId),
  }));
}

/**
 * Overwrite every accepted direction's live bundle from the replay tree. All
 * bundles are built and size-checked before the first one is written.
 */
export function packOutlineTree(outlineId: string): Promise<{ directionIds: string[] }> {
  readOutlineOrThrow(outlineId);
  return withOutlineMockupsLock(outlineId, async () => {
    const directionIds = acceptedDirectionIds(outlineId);
    const tree = replayTreeDir(outlineId);
    const bundles = directionIds.map((directionId) => ({
      name: liveBundleName(directionId),
      bytes: packReplayBundle(tree, directionId),
    }));
    for (const bundle of bundles) assertReplayBundleWithinLimit(bundle.name, bundle.bytes);
    for (const bundle of bundles) {
      await replaceOutlineAttachment(outlineId, bundle.name, bundle.bytes);
    }
    return { directionIds };
  });
}

/**
 * Directory the mockup author writes. The outline's replay tree when it
 * holds live bundles — a direction accepted after the first save lives in
 * that same tree — and the planning scratch for `conversationId` otherwise.
 */
export function authorWorkspace(outlineId: string, conversationId: string): string {
  readOutlineOrThrow(outlineId);
  if (liveDirectionIds(outlineId).length > 0) return replayTreeDir(outlineId);
  return mockupScratchDir(conversationId);
}

/**
 * Save one direction's bundle from the replay tree. A direction the outline
 * already accepted, and a direction whose receiving issue is the outline,
 * is written onto the outline. A new direction is attached to `issueId`
 * instead, so a later outline save can move it.
 */
export function acceptOutlineDirection(
  outlineId: string,
  directionId: string,
  issueId: string,
): Promise<void> {
  readOutlineOrThrow(outlineId);
  const name = requireLiveBundleName(directionId);
  return withOutlineMockupsLock(outlineId, async () => {
    const bytes = packReplayBundle(replayTreeDir(outlineId), directionId);
    assertReplayBundleWithinLimit(name, bytes);
    if (issueId === outlineId || liveDirectionIds(outlineId).includes(directionId)) {
      await replaceOutlineAttachment(outlineId, name, bytes);
      return;
    }
    if (listAttachments(issueId).some((attachment) => attachment.name === name)) {
      await replaceAttachment(issueId, name, bytes);
      return;
    }
    await putAttachment(issueId, name, bytes);
  });
}

/**
 * Remove one accepted direction. Deletes its live bundle and its folder in
 * the replay tree. Shared `harness.json`, `package.json`, and other
 * directions stay, so a running Storybook drops that direction's stories
 * in place.
 */
export function dropOutlineDirection(outlineId: string, directionId: string): Promise<void> {
  readOutlineOrThrow(outlineId);
  const name = requireLiveBundleName(directionId);
  return withOutlineMockupsLock(outlineId, async () => {
    await removeOutlineAttachment(outlineId, name);
    rmSync(join(replayTreeDir(outlineId), directionId), { recursive: true, force: true });
  });
}

/** Record the mockup author's run: `running` while it edits, `failed` when it stops without a pack, `clean` after one. */
export function noteAuthorRun(outlineId: string, state: AuthorRunState): Promise<void> {
  readOutlineOrThrow(outlineId);
  return withOutlineMockupsLock(outlineId, async () => writeAuthorRunState(outlineId, state));
}
