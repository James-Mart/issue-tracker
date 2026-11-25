import { existsSync } from "node:fs";
import { join } from "node:path";
import type { OutlineMockupStackStatus } from "../schemas.js";
import { IssueError } from "./errors.js";
import { readOutlineOrThrow } from "./issues.js";
import {
  liveLeases,
  readAuthorRunState,
  readBoundSession,
  readOutlineStorybookState,
  readStackFailure,
  removeStackFailure,
  replayTreeDir,
  writeStackFailure,
} from "./outline-mockup-store.js";
import {
  MockupCommandFailure,
  listAcceptedDirections,
  replayTreeServePlan,
} from "./outline-replay-tree.js";
import { acquireViewerLease, releaseLease } from "./outline-storybook.js";
import { isRecordedProcessLive } from "./storybook-process.js";

function liveOutlineStorybook(outlineId: string): boolean {
  const state = readOutlineStorybookState(outlineId);
  return state !== null && isRecordedProcessLive(state);
}

function failureOf(err: unknown): { command?: string; outputTail: string } {
  if (err instanceof MockupCommandFailure) {
    return { command: err.command, outputTail: err.outputTail };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { outputTail: message };
}

/** Status the Mockups tab reads for one outline. */
export function readOutlineMockupStack(outlineId: string): OutlineMockupStackStatus {
  readOutlineOrThrow(outlineId);
  const directions = listAcceptedDirections(outlineId).map((direction) => direction.directionId);
  const sessionId = readBoundSession(outlineId);
  const live = liveOutlineStorybook(outlineId);
  const failure = live ? null : readStackFailure(outlineId);
  const authorRun = readAuthorRunState(outlineId);
  const hasHarness = existsSync(join(replayTreeDir(outlineId), "harness.json"));
  const plan = replayTreeServePlan(authorRun, directions.length, hasHarness);
  const phase = live ? "live" : failure ? "failed" : "stopped";
  return {
    phase,
    ...(failure?.command ? { command: failure.command } : {}),
    ...(failure ? { outputTail: failure.outputTail } : {}),
    canRestore: plan !== "none",
    // Clean plus bundles is not enough: the tree matches the pack only once
    // harness.json is on disk.
    treeMatchesPack: plan === "restore" && hasHarness,
    ...(sessionId ? { sessionId } : {}),
    authorRun,
    directions,
  };
}

/**
 * Hold the viewer lease, starting Storybook when it is down. Install and
 * start failures stay on the status as `failed` with the command and output
 * tail. An outline with no bound session is refused before anything starts.
 */
export async function startOutlineMockupStack(
  outlineId: string,
): Promise<OutlineMockupStackStatus> {
  readOutlineOrThrow(outlineId);
  if (!readBoundSession(outlineId)) {
    throw new IssueError(
      "validation",
      `outline ${JSON.stringify(outlineId)} has no bound mockup session`,
    );
  }
  try {
    await acquireViewerLease(outlineId);
    removeStackFailure(outlineId);
  } catch (err) {
    writeStackFailure(outlineId, failureOf(err));
  }
  return readOutlineMockupStack(outlineId);
}

/** Release the outline's viewer lease. A capture lease keeps Storybook up. */
export async function stopOutlineMockupStack(
  outlineId: string,
): Promise<OutlineMockupStackStatus> {
  readOutlineOrThrow(outlineId);
  const viewer = liveLeases(outlineId).find((lease) => lease.kind === "viewer");
  if (viewer) {
    try {
      await releaseLease(viewer.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // The lease can disappear between the read and the release.
      if (!message.startsWith("unknown lease ")) throw err;
    }
  }
  return readOutlineMockupStack(outlineId);
}
