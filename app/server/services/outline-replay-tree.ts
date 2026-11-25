import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  MAX_ATTACHMENT_BYTES,
  attachmentPath,
  listAttachments,
  replaceOutlineAttachment,
} from "./attachments.js";
import { readOutlineOrThrow } from "./issues.js";
import { sandboxNpmCacheDir } from "./mockup-scratch.js";
import { liveBundleDirectionId, liveBundleName } from "./outline-attachments.js";
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
 * Ready the tree for a Storybook start, for a caller holding the outline's
 * lock. A clean tree with bundles is restored from them; a running or failed
 * author run keeps the tree it left, which is installed as it stands.
 */
export async function prepareReplayTreeForServe(outlineId: string): Promise<void> {
  if (readAuthorRunState(outlineId) === "clean" && liveDirectionIds(outlineId).length > 0) {
    await restoreTreeFromBundles(outlineId);
  } else if (existsSync(join(replayTreeDir(outlineId), "harness.json"))) {
    await installReplayTree(outlineId);
  } else {
    throw new Error(`outline ${JSON.stringify(outlineId)} has no mockups to serve`);
  }
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
    const oversized = bundles.find((bundle) => bundle.bytes.byteLength > MAX_ATTACHMENT_BYTES);
    if (oversized) {
      throw new Error(
        `replay bundle ${oversized.name} exceeds the ${MAX_ATTACHMENT_BYTES} byte attachment limit`,
      );
    }
    for (const bundle of bundles) {
      await replaceOutlineAttachment(outlineId, bundle.name, bundle.bytes);
    }
    return { directionIds };
  });
}

/** Record the mockup author's run: `running` while it edits, `failed` when it stops without a pack, `clean` after one. */
export function noteAuthorRun(outlineId: string, state: AuthorRunState): Promise<void> {
  readOutlineOrThrow(outlineId);
  return withOutlineMockupsLock(outlineId, async () => writeAuthorRunState(outlineId, state));
}
