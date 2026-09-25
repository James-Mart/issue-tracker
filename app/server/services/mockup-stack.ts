import { spawn, type ChildProcess } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { createServer, type AddressInfo, type Server } from "node:net";
import { appDir } from "../config.js";
import { ensureChildReaper, reapExitedChildren } from "./child-reaper.js";
import {
  conversationMetaExists,
  harnessConfigPath,
  listRecordedMockupStackIds,
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

/**
 * A conversation's Storybook dev server on a port picked free at start time.
 * Agents run mockup rounds here instead of on the human's stack.
 */

const MOCKUP_HEAP_MB = 2048;

const READY_TIMEOUT_MS = 90_000;
const READY_POLL_MS = 250;
const READY_PROBE_TIMEOUT_MS = 5_000;
const TERM_GRACE_MS = 8_000;
const KILL_GRACE_MS = 2_000;
const EXIT_POLL_MS = 100;

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
  /** State removed for dead, recycled, or unowned groups. Unowned groups are not signaled. */
  staleStateRemoved: string[];
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readProcInfo(
  pid: number,
): { state: string; startTime: string; ppid: number; pgrp: number } | null {
  let stat: string;
  try {
    stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch {
    return null;
  }
  // The comm field is parenthesized and may itself contain spaces and parens,
  // so the numbered fields start after its closing paren.
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  const state = fields[0];
  const startTime = fields[19];
  const ppid = Number(fields[1]);
  const pgrp = Number(fields[2]);
  if (!state || !startTime || !Number.isInteger(ppid) || !Number.isInteger(pgrp)) {
    throw new Error(`unparseable /proc/${pid}/stat`);
  }
  return { state, startTime, ppid, pgrp };
}

/**
 * Signal check: the recorded pid is still that process, and not state Z.
 * State Z is not collection. Collection is `waitpid` on a child this process owns.
 */
export function isMockupStackLive(state: MockupStackState): boolean {
  const info = readProcInfo(state.pid);
  return info !== null && info.state !== "Z" && info.startTime === state.startTime;
}

/** The recorded process is a child of this process (running or zombie). */
function isOurRecordedProcess(state: MockupStackState): boolean {
  const info = readProcInfo(state.pid);
  return (
    info !== null &&
    info.ppid === process.pid &&
    info.startTime === state.startTime
  );
}

async function listenOnFreePort(): Promise<Server> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, () => resolve());
  });
  return server;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function pickFreePort(): Promise<number> {
  const probe = await listenOnFreePort();
  const port = (probe.address() as AddressInfo).port;
  await closeServer(probe);
  return port;
}

function binPath(name: string): string {
  const bin = `${appDir}/node_modules/.bin/${name}`;
  if (!existsSync(bin)) {
    throw new Error(`missing ${bin} — run \`npm install\` from \`app/\``);
  }
  return bin;
}

function tailLog(path: string, maxLines = 20): string {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8").trimEnd().split("\n").slice(-maxLines).join("\n");
}

/** Public prefix the manager, preview iframe, and HMR client resolve on. */
export function mockupStorybookBase(conversationId: string): string {
  return `/mockups/${conversationId}/`;
}

/** Storybook stays on loopback. The tracker origin proxies this prefix. */
export function storybookDevArgs(port: number): string[] {
  return [
    "dev",
    "-c",
    ".storybook",
    "--no-open",
    "--ci",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
  ];
}

function appendNodeOptions(
  existing: string | undefined,
  ...flags: string[]
): string {
  const addition = flags.join(" ");
  const trimmed = existing?.trim();
  return trimmed ? `${trimmed} ${addition}` : addition;
}

function storybookNodeOptions(heapReportDir: string): string {
  return appendNodeOptions(
    process.env.NODE_OPTIONS,
    `--max-old-space-size=${MOCKUP_HEAP_MB}`,
    "--report-on-fatalerror",
    `--report-directory=${heapReportDir}`,
  );
}

function spawnStorybook(
  conversationId: string,
  port: number,
  harnessPath: string,
): { child: ChildProcess; pid: number; startTime: string } {
  const logPath = mockupStackLogPath(conversationId);
  const heapReportDir = join(mockupStackDir(conversationId), "heap-reports");
  mkdirSync(heapReportDir, { recursive: true });
  const storybookBin = binPath("storybook");
  const args = storybookDevArgs(port);
  const env = {
    ...process.env,
    MOCKUP_HARNESS_CONFIG: harnessPath,
    MOCKUP_STORYBOOK_BASE: mockupStorybookBase(conversationId),
    NODE_OPTIONS: storybookNodeOptions(heapReportDir),
  };
  const fd = openSync(logPath, "w");
  let child: ChildProcess;
  try {
    if (process.platform === "linux") {
      child = spawn(
        "sh",
        [
          "-c",
          'echo 1000 > /proc/self/oom_score_adj; exec "$@"',
          "mockup-storybook",
          storybookBin,
          ...args,
        ],
        {
          cwd: appDir,
          env,
          detached: true,
          stdio: ["ignore", fd, fd],
        },
      );
    } else {
      child = spawn(storybookBin, args, {
        cwd: appDir,
        env,
        detached: true,
        stdio: ["ignore", fd, fd],
      });
    }
  } finally {
    closeSync(fd);
  }
  child.unref();
  const pid = child.pid;
  if (pid === undefined) {
    throw new Error("failed to spawn mockup stack storybook");
  }
  const info = readProcInfo(pid);
  if (info === null) {
    throw new Error(
      `mockup stack storybook exited immediately:\n${tailLog(logPath)}`,
    );
  }
  return { child, pid, startTime: info.startTime };
}

async function probe(url: string): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(READY_PROBE_TIMEOUT_MS) });
}

async function waitForReady(
  conversationId: string,
  baseUrl: string,
  child: ChildProcess,
): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastFailure = "no probe attempted";
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `mockup stack storybook exited while starting:\n${tailLog(
          mockupStackLogPath(conversationId),
        )}`,
      );
    }
    try {
      const response = await probe(baseUrl);
      if (response.ok) return;
      lastFailure = `status ${response.status}`;
    } catch (err) {
      lastFailure = err instanceof Error ? err.message : String(err);
    }
    await delay(READY_POLL_MS);
  }
  throw new Error(
    `mockup stack for ${conversationId} was not ready within ${READY_TIMEOUT_MS}ms (${lastFailure})`,
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
  writeSessionOutcome(conversationId, "open");
  mkdirSync(mockupStackDir(conversationId), { recursive: true });

  const port = await pickFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  const { child, pid, startTime } = spawnStorybook(
    conversationId,
    port,
    harnessPath,
  );

  const state: MockupStackState = {
    port,
    pid,
    startTime,
    baseUrl,
    startedAt: new Date().toISOString(),
  };
  writeMockupStackState(conversationId, state);

  try {
    await waitForReady(conversationId, baseUrl, child);
  } catch (err) {
    await stopMockupStack(conversationId);
    throw err;
  }

  return { state, reused: false };
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
  }
}

/** True when any child of this process still belongs to one of these groups. */
function groupsHaveOurChildren(groups: ReadonlySet<number>): boolean {
  if (groups.size === 0) return false;
  let entries: string[];
  try {
    entries = readdirSync("/proc");
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (!/^[1-9]\d*$/.test(entry)) continue;
    const info = readProcInfo(Number(entry));
    if (!info) continue;
    if (info.ppid === process.pid && groups.has(info.pgrp)) return true;
  }
  return false;
}

/**
 * Collection is `waitpid`, not state Z. `timeoutMs` is how long to wait before
 * reporting that the group is still uncollected. `Infinity` waits until
 * `waitpid` collects it.
 */
async function waitUntilGroupsCollected(
  groups: ReadonlySet<number>,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    reapExitedChildren();
    if (!groupsHaveOurChildren(groups)) return true;
    if (Date.now() >= deadline) return false;
    await delay(EXIT_POLL_MS);
  }
}

/**
 * Story stop sequence for one recorded group. A pid that is not this process's
 * child is left unsignaled. `isMockupStackLive` is the signal check: an owned
 * live group gets SIGTERM, then SIGKILL after `TERM_GRACE_MS`. The promise
 * settles only after `waitpid` collects the group. Past `KILL_GRACE_MS` it
 * keeps waiting, then rejects.
 */
async function stopRecordedGroup(state: MockupStackState): Promise<void> {
  if (!isOurRecordedProcess(state)) return;
  const info = readProcInfo(state.pid);
  if (!info) return;

  const groups = new Set<number>([info.pgrp]);
  if (isMockupStackLive(state)) {
    signalGroup(state.pid, "SIGTERM");
    const collectedOnTerm = await waitUntilGroupsCollected(groups, TERM_GRACE_MS);
    if (!collectedOnTerm) {
      signalGroup(info.pgrp, "SIGKILL");
      const collectedOnKill = await waitUntilGroupsCollected(groups, KILL_GRACE_MS);
      if (!collectedOnKill) {
        await waitUntilGroupsCollected(groups, Number.POSITIVE_INFINITY);
        throw new Error(
          `mockup stack survived SIGKILL (pid ${state.pid}, port ${state.port})`,
        );
      }
    }
    return;
  }

  await waitUntilGroupsCollected(groups, Number.POSITIVE_INFINITY);
}

function removeMockupStackState(conversationId: string): void {
  rmSync(mockupStackStatePathDirect(conversationId), { force: true });
}

/**
 * Stop this conversation's Storybook stack and release its port. A
 * conversation with no recorded stack is not an error. The session
 * outcome file is left in place. `ended` writes `"ended"` first.
 *
 * A recorded pid that is not this process's child is removed with no signal.
 * An owned live group gets SIGTERM, then SIGKILL after `TERM_GRACE_MS`. The
 * promise settles only after `waitpid` collects the group. Past
 * `KILL_GRACE_MS` it keeps waiting, then rejects.
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

  try {
    await stopRecordedGroup(state);
  } finally {
    rmSync(mockupStackStatePath(conversationId), { force: true });
  }
  return { stopped: true, state };
}

/**
 * Stop every recorded mockup stack. Returns each owned live stack's freed
 * port. Shutdown awaits this before exiting; collection finishes before the
 * promise settles. A group still uncollected past `KILL_GRACE_MS` rejects
 * only after `waitpid` collects it.
 */
export async function stopAllMockupStacks(): Promise<MockupStackStopAllEntry[]> {
  ensureChildReaper();
  const freed: MockupStackStopAllEntry[] = [];
  let failure: Error | undefined;
  for (const conversationId of listRecordedMockupStackIds()) {
    const state = readMockupStackStateDirect(conversationId);
    if (!state) continue;
    const ownedLive = isOurRecordedProcess(state) && isMockupStackLive(state);
    try {
      await stopRecordedGroup(state);
    } catch (err) {
      failure = err instanceof Error ? err : new Error(String(err));
    } finally {
      removeMockupStackState(conversationId);
    }
    if (ownedLive) {
      freed.push({ conversationId, port: state.port });
    }
  }
  if (failure) throw failure;
  return freed;
}

/**
 * Drop recorded mockup stacks at API boot. Dead, recycled, and unowned groups
 * lose their state record and are not signaled. A live pid whose conversation
 * meta is gone is included in `staleStateRemoved`. Scratch is left in place.
 */
export async function reapOrphanedMockupStacksAtBoot(): Promise<MockupStackReapReport> {
  const report: MockupStackReapReport = {
    staleStateRemoved: [],
  };

  for (const conversationId of listRecordedMockupStackIds()) {
    const state = readMockupStackStateDirect(conversationId);
    if (!state) continue;

    const keep =
      isOurRecordedProcess(state) &&
      isMockupStackLive(state) &&
      conversationMetaExists(conversationId);
    if (keep) continue;

    removeMockupStackState(conversationId);
    report.staleStateRemoved.push(conversationId);
  }

  return report;
}
