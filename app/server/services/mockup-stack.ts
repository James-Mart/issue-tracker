import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadHarnessConfig } from "../../.storybook/harness-config.js";
import { REACT_PACKAGES, resolveReactRoot } from "../../.storybook/harness-react.js";
import { ensureChildReaper } from "./child-reaper.js";
import { assertPluginAppManifestClean } from "./mockup-app-manifest.js";
import {
  installSandboxPackages,
  type RunSandboxNpm,
} from "./mockup-sandbox.js";
import {
  conversationMetaExists,
  harnessConfigPath,
  listRecordedMockupStackIds,
  mockupScratchDir,
  mockupStackDir,
  mockupStackLogPath,
  mockupStackStatePath,
  mockupStackStatePathDirect,
  readMockupStackState,
  readMockupStackStateDirect,
  writeMockupStackState,
  writeSessionOutcome,
  type MockupStackState,
} from "./mockup-scratch.js";
import {
  isRecordedStorybookGroup,
  isRecordedProcessLive,
  mockupStorybookBase,
  pickFreePort,
  readProcInfo,
  reportStorybookHeapLimit,
  spawnStorybook,
  stopStorybookGroup,
  waitForStorybookReady,
} from "./storybook-process.js";

/**
 * A conversation's Storybook dev server on a port picked free at start time.
 * Agents run mockup rounds here instead of on the human's stack.
 */

export interface MockupStackHandle {
  state: MockupStackState;
  /** True when a live stack for this conversation was already running. */
  reused: boolean;
}

/** `stopped: false` means no stack was recorded for the conversation. */
export type MockupStackStopResult =
  | { stopped: true; state: MockupStackState }
  | { stopped: false; state: null };

export type MockupStackStopAllEntry = {
  conversationId: string;
  port: number;
};

export type MockupStackReapReport = {
  /** State removed for a dead pid, a recycled pid, or a live stack whose conversation is gone. Nothing is signaled. */
  staleStateRemoved: string[];
};

export function isMockupStackLive(state: MockupStackState): boolean {
  return isRecordedProcessLive(state);
}

/**
 * A live stack the CLI started. This process is not its parent, so API
 * shutdown leaves it running and leaves its state in place.
 */
function isCliStartedLiveStack(state: MockupStackState): boolean {
  const info = readProcInfo(state.pid);
  return (
    info !== null &&
    info.state !== "Z" &&
    info.startTime === state.startTime &&
    info.ppid !== process.pid
  );
}

function heapReportDir(conversationId: string): string {
  return join(mockupStackDir(conversationId), "heap-reports");
}

/**
 * When the target has no installed React, install `react` and `react-dom`
 * into the sandbox at the ranges the target declares, so the React aliases
 * have a copy to bind.
 */
export function ensureTargetReact(
  conversationId: string,
  runNpm?: RunSandboxNpm,
): void {
  const config = loadHarnessConfig(harnessConfigPath(conversationId));
  const scratch = mockupScratchDir(conversationId);
  if (
    resolveReactRoot({
      aliases: config.aliases,
      targetRoot: config.targetRoot,
      scratchRoot: scratch,
    })
  ) {
    return;
  }
  installSandboxPackages(
    {
      conversationId,
      from: config.targetRoot,
      packages: REACT_PACKAGES,
    },
    runNpm,
  );
}

function assertHarnessConfig(conversationId: string): string {
  const path = harnessConfigPath(conversationId);
  if (!existsSync(path)) {
    throw new Error(`missing mockup harness configuration at ${path}`);
  }
  return path;
}

/**
 * Start (or adopt) this conversation's Storybook stack and return its base URL.
 * A recorded stack whose process is gone is torn down first.
 */
export async function startMockupStack(
  conversationId: string,
): Promise<MockupStackHandle> {
  await assertPluginAppManifestClean();
  ensureChildReaper();
  const existing = readMockupStackState(conversationId);
  if (existing) {
    if (isMockupStackLive(existing)) {
      writeSessionOutcome(conversationId, "open");
      return { state: existing, reused: true };
    }
    await stopMockupStack(conversationId);
  }

  const harnessPath = assertHarnessConfig(conversationId);
  ensureTargetReact(conversationId);
  writeSessionOutcome(conversationId, "open");
  mkdirSync(mockupStackDir(conversationId), { recursive: true });

  const port = await pickFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  const { child, pid, startTime } = spawnStorybook({
    logPath: mockupStackLogPath(conversationId),
    heapReportDir: heapReportDir(conversationId),
    port,
    harnessPath,
    base: mockupStorybookBase(conversationId),
  });

  const state: MockupStackState = {
    port,
    pid,
    startTime,
    baseUrl,
    startedAt: new Date().toISOString(),
  };
  writeMockupStackState(conversationId, state);

  try {
    await waitForStorybookReady({
      label: conversationId,
      logPath: mockupStackLogPath(conversationId),
      baseUrl,
      child,
    });
  } catch (err) {
    await stopMockupStack(conversationId);
    throw err;
  }

  return { state, reused: false };
}

function removeMockupStackState(conversationId: string): void {
  rmSync(mockupStackStatePathDirect(conversationId), { force: true });
}

/**
 * Stop this conversation's Storybook stack and release its port. A
 * conversation with no recorded stack is not an error. The session
 * outcome file is left in place. `ended` writes `"ended"` first.
 *
 * A live group leader is signaled even when this process is not its parent.
 * A pid whose start time differs, or that does not lead the detached process
 * group, is removed with no signal. A live group gets SIGTERM, then SIGKILL
 * after `TERM_GRACE_MS`. The promise resolves only after the group is gone
 * and the recorded port is not listening. When the stack is still up past
 * `KILL_GRACE_MS`, the promise rejects and the state file stays so a retry
 * can find it.
 */
export async function stopMockupStack(
  conversationId: string,
  options?: { ended?: boolean },
): Promise<MockupStackStopResult> {
  ensureChildReaper();
  if (options?.ended) {
    writeSessionOutcome(conversationId, "ended");
  }
  const state = readMockupStackState(conversationId);
  if (!state) return { stopped: false, state: null };

  reportStorybookHeapLimit(heapReportDir(conversationId), state.pid);

  await stopStorybookGroup(state);
  rmSync(mockupStackStatePath(conversationId), { force: true });
  return { stopped: true, state };
}

async function stopRecordedMockupStacks(
  keepCliStarted: boolean,
): Promise<MockupStackStopAllEntry[]> {
  ensureChildReaper();
  const freed: MockupStackStopAllEntry[] = [];
  let failure: Error | undefined;
  for (const conversationId of listRecordedMockupStackIds()) {
    const state = readMockupStackStateDirect(conversationId);
    if (!state) continue;
    if (keepCliStarted && isCliStartedLiveStack(state)) continue;
    const ownedLive = isRecordedStorybookGroup(state) && isMockupStackLive(state);
    try {
      await stopStorybookGroup(state);
    } catch (err) {
      failure = err instanceof Error ? err : new Error(String(err));
      continue;
    }
    removeMockupStackState(conversationId);
    if (ownedLive) {
      freed.push({ conversationId, port: state.port });
    }
  }
  if (failure) throw failure;
  return freed;
}

/**
 * Stop every recorded mockup stack, including one the CLI started. Returns
 * each live group's freed port, and only after that port is not listening.
 * A stack still up past `KILL_GRACE_MS` keeps its state and rejects.
 */
export async function stopAllMockupStacks(): Promise<MockupStackStopAllEntry[]> {
  return stopRecordedMockupStacks(false);
}

/**
 * API shutdown. Stops stacks this process spawned. A live stack whose parent
 * is not this process keeps running and keeps its state, so a restart does
 * not take down a round the human is looking at.
 */
export async function stopSpawnedMockupStacksOnShutdown(): Promise<
  MockupStackStopAllEntry[]
> {
  return stopRecordedMockupStacks(true);
}

/**
 * Drop recorded mockup stacks at API boot. A live stack whose conversation
 * still exists keeps its state, including one whose parent is not this
 * process. Dead and recycled pids lose their state and are not signaled. A
 * live pid whose conversation is gone is included in `staleStateRemoved` and
 * is not signaled. Scratch is left in place.
 */
export async function reapOrphanedMockupStacksAtBoot(): Promise<MockupStackReapReport> {
  const report: MockupStackReapReport = {
    staleStateRemoved: [],
  };

  for (const conversationId of listRecordedMockupStackIds()) {
    const state = readMockupStackStateDirect(conversationId);
    if (!state) continue;

    const keep =
      isMockupStackLive(state) && conversationMetaExists(conversationId);
    if (keep) continue;

    removeMockupStackState(conversationId);
    report.staleStateRemoved.push(conversationId);
  }

  return report;
}
