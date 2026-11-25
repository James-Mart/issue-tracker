import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { isSlugSafe } from "../slug.js";
import { ensureChildReaper } from "./child-reaper.js";
import { readOutlineOrThrow } from "./issues.js";
import { assertPluginAppManifestClean } from "./mockup-app-manifest.js";
import { conversationMetaExists } from "./mockup-scratch.js";
import {
  currentProcessHolder,
  leaseOutlineId,
  liveLeases,
  outlineForBoundSession,
  outlineMockupsRoot,
  outlineStorybookDir,
  outlineStorybookLogPath,
  readBoundSession,
  readOutlineStorybookState,
  removeLease,
  removeOutlineStorybookState,
  replayTreeDir,
  withOutlineMockupsLock,
  writeBoundSession,
  writeLease,
  writeOutlineStorybookState,
  type OutlineLease,
  type OutlineStorybookState,
} from "./outline-mockup-store.js";
import { MockupCommandFailure, prepareReplayTreeForServe } from "./outline-replay-tree.js";
import {
  isRecordedProcessLive,
  mockupStorybookBase,
  pickFreePort,
  reportStorybookHeapLimit,
  spawnStorybook,
  stopStorybookGroup,
  storybookStartCommand,
  tailLog,
  waitForStorybookReady,
} from "./storybook-process.js";

/**
 * One loopback Storybook serves an outline's replay tree. It stays up while
 * a lease is held: the viewer lease is the human session, a capture lease is
 * an agent screenshot. The last release stops it.
 */

export interface OutlineLeaseHandle {
  leaseId: string;
  baseUrl: string;
}

function heapReportDir(outlineId: string): string {
  return join(outlineStorybookDir(outlineId), "heap-reports");
}

function liveStorybook(outlineId: string): OutlineStorybookState | null {
  const state = readOutlineStorybookState(outlineId);
  return state && isRecordedProcessLive(state) ? state : null;
}

async function stopStorybook(outlineId: string): Promise<void> {
  const state = readOutlineStorybookState(outlineId);
  if (!state) return;
  reportStorybookHeapLimit(heapReportDir(outlineId), state.pid);
  await stopStorybookGroup(state);
  removeOutlineStorybookState(outlineId);
}

/** Start the outline's Storybook on its prepared replay tree unless it is live. */
async function ensureStorybook(outlineId: string): Promise<OutlineStorybookState> {
  const live = liveStorybook(outlineId);
  if (live) return live;
  await stopStorybook(outlineId);
  await assertPluginAppManifestClean();
  ensureChildReaper();

  await prepareReplayTreeForServe(outlineId);

  const conversationId = readBoundSession(outlineId);
  const base = conversationId ? mockupStorybookBase(conversationId) : null;
  const port = await pickFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logPath = outlineStorybookLogPath(outlineId);
  mkdirSync(outlineStorybookDir(outlineId), { recursive: true });
  const startFailure = (err: unknown) =>
    new MockupCommandFailure(
      storybookStartCommand(port),
      tailLog(logPath) || (err instanceof Error ? err.message : String(err)),
    );

  let spawned: ReturnType<typeof spawnStorybook>;
  try {
    spawned = spawnStorybook({
      logPath,
      heapReportDir: heapReportDir(outlineId),
      port,
      harnessPath: join(replayTreeDir(outlineId), "harness.json"),
      base: base ?? undefined,
    });
  } catch (err) {
    throw startFailure(err);
  }
  const state: OutlineStorybookState = {
    port,
    pid: spawned.pid,
    startTime: spawned.startTime,
    baseUrl,
    base,
    startedAt: new Date().toISOString(),
  };
  writeOutlineStorybookState(outlineId, state);
  try {
    await waitForStorybookReady({
      label: `outline ${outlineId}`,
      logPath,
      baseUrl,
      child: spawned.child,
    });
  } catch (err) {
    const failure = startFailure(err);
    await stopStorybook(outlineId);
    throw failure;
  }
  return state;
}

async function acquireLease(
  outlineId: string,
  kind: OutlineLease["kind"],
): Promise<{ leaseId: string; state: OutlineStorybookState }> {
  return withOutlineMockupsLock(outlineId, async () => {
    const state = await ensureStorybook(outlineId);
    const viewer =
      kind === "viewer"
        ? liveLeases(outlineId).find((lease) => lease.kind === "viewer")
        : undefined;
    if (viewer) return { leaseId: viewer.id, state };
    const lease: OutlineLease = {
      id: `${outlineId}.${randomUUID()}`,
      kind,
      ...(kind === "capture" ? { holder: currentProcessHolder() } : {}),
      acquiredAt: new Date().toISOString(),
    };
    writeLease(outlineId, lease);
    return { leaseId: lease.id, state };
  });
}

/**
 * Hold the human session on the outline's Storybook, starting it when down.
 * One viewer lease per outline: a second acquire returns the held one. The
 * base URL is the public `/mockups/<conversationId>/` of the bound session.
 */
export async function acquireViewerLease(outlineId: string): Promise<OutlineLeaseHandle> {
  readOutlineOrThrow(outlineId);
  const conversationId = readBoundSession(outlineId);
  if (!conversationId) {
    throw new Error(`outline ${JSON.stringify(outlineId)} has no bound mockup session`);
  }
  const { leaseId } = await acquireLease(outlineId, "viewer");
  return { leaseId, baseUrl: mockupStorybookBase(conversationId) };
}

/**
 * Hold the outline's Storybook for an agent screenshot, starting it when
 * down. The lease ends with this process if it is never released. The base
 * URL is the loopback Storybook.
 */
export async function acquireCaptureLease(outlineId: string): Promise<OutlineLeaseHandle> {
  readOutlineOrThrow(outlineId);
  const { leaseId, state } = await acquireLease(outlineId, "capture");
  return { leaseId, baseUrl: state.baseUrl };
}

/** End one lease. When no lease is left, the outline's Storybook stops. */
export async function releaseLease(leaseId: string): Promise<void> {
  const outlineId = leaseOutlineId(leaseId);
  await withOutlineMockupsLock(outlineId, async () => {
    if (!removeLease(outlineId, leaseId)) {
      throw new Error(`unknown lease ${JSON.stringify(leaseId)}`);
    }
    if (liveLeases(outlineId).length === 0) await stopStorybook(outlineId);
  });
}

/**
 * Serve the outline's Storybook at `/mockups/<conversationId>/`. A conversation
 * binds to one outline; binding another session is refused while Storybook
 * runs under the current one.
 */
export async function bindMockupSession(
  outlineId: string,
  conversationId: string,
): Promise<void> {
  readOutlineOrThrow(outlineId);
  if (!isSlugSafe(conversationId) || !conversationMetaExists(conversationId)) {
    throw new Error(`unknown conversation ${JSON.stringify(conversationId)}`);
  }
  const bound = outlineForBoundSession(conversationId);
  if (bound !== null && bound !== outlineId) {
    throw new Error(
      `conversation ${JSON.stringify(conversationId)} is already bound to outline ${JSON.stringify(bound)}`,
    );
  }
  await withOutlineMockupsLock(outlineId, async () => {
    if (readBoundSession(outlineId) === conversationId) return;
    refuseRebindWhileLive(outlineId);
    writeBoundSession(outlineId, conversationId);
  });
}

/**
 * Bind the session `create` makes to the outline. The refusal while Storybook
 * runs comes before `create`, so a refused bind creates nothing.
 */
export async function bindCreatedMockupSession<T>(
  outlineId: string,
  create: () => Promise<T>,
  sessionOf: (created: T) => string,
): Promise<T> {
  readOutlineOrThrow(outlineId);
  return withOutlineMockupsLock(outlineId, async () => {
    refuseRebindWhileLive(outlineId);
    const created = await create();
    writeBoundSession(outlineId, sessionOf(created));
    return created;
  });
}

function refuseRebindWhileLive(outlineId: string): void {
  if (liveStorybook(outlineId)) {
    throw new Error(
      `outline ${JSON.stringify(outlineId)}'s Storybook is running under another session; release its leases first`,
    );
  }
}

/**
 * Where `/mockups/<conversationId>/` goes for a conversation bound to an
 * outline: the live Storybook's loopback URL, or null while it is down.
 * Undefined when the conversation is not bound, so the planning scratch
 * stack serves it.
 */
export function boundMockupSessionTarget(
  conversationId: string,
): { baseUrl: string | null } | undefined {
  const outlineId = outlineForBoundSession(conversationId);
  if (outlineId === null) return undefined;
  const state = liveStorybook(outlineId);
  return {
    baseUrl:
      state !== null && state.base === mockupStorybookBase(conversationId)
        ? state.baseUrl
        : null,
  };
}

/** Stop the outline's Storybook and delete its replay tree, leases, and records. */
export async function removeOutlineReplayTree(outlineId: string): Promise<void> {
  if (!existsSync(outlineMockupsRoot(outlineId))) return;
  await withOutlineMockupsLock(outlineId, async () => {
    await stopStorybook(outlineId);
    rmSync(outlineMockupsRoot(outlineId), { recursive: true, force: true });
  });
}
