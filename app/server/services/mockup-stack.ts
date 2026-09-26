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
const HEAP_OOM_EVENT = "Allocation failed - JavaScript heap out of memory";

export function mockupStackMemoryLimitMessage(): string {
  return `mockup stack memory limit: storybook exceeded the ${MOCKUP_HEAP_MB} MB heap limit`;
}

interface HeapReport {
  header?: {
    event?: string;
    processId?: number;
  };
}

function isHeapLimitReport(report: HeapReport): boolean {
  return report.header?.event === HEAP_OOM_EVENT;
}

function hasHeapLimitReportForPid(reportDir: string, pid: number): boolean {
  if (!existsSync(reportDir)) return false;
  for (const name of readdirSync(reportDir)) {
    if (!name.startsWith("report.") || !name.endsWith(".json")) {
      continue;
    }
    if (!name.includes(`.${pid}.`)) {
      continue;
    }
    try {
      const report = JSON.parse(
        readFileSync(join(reportDir, name), "utf8"),
      ) as HeapReport;
      if (isHeapLimitReport(report)) {
        return true;
      }
    } catch {
      // skip malformed report
    }
  }
  return false;
}

function reportMockupStackHeapLimit(
  conversationId: string,
  pid: number,
): void {
  const reportDir = join(mockupStackDir(conversationId), "heap-reports");
  if (!hasHeapLimitReportForPid(reportDir, pid)) {
    return;
  }
  console.error(mockupStackMemoryLimitMessage());
}

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
  /** State removed for a dead pid, a recycled pid, or a live stack whose conversation is gone. Nothing is signaled. */
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

/**
 * The recorded pid still leads the process group created by the detached
 * spawn, pinned by its `/proc` start time. Parentage is not ownership: the
 * CLI exits and the group is reparented.
 */
function isRecordedStackGroup(state: MockupStackState): boolean {
  const info = readProcInfo(state.pid);
  return (
    info !== null &&
    info.startTime === state.startTime &&
    info.pgrp === state.pid
  );
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

/**
 * True while any process still belongs to one of these groups, including a
 * group reparented away from this process. Zombies count until they are
 * reaped.
 */
function groupsStillPresent(groups: ReadonlySet<number>): boolean {
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
    if (groups.has(info.pgrp)) return true;
  }
  return false;
}

/** True when any TCP socket is in LISTEN on `port` (`/proc/net/tcp` state `0A`). */
function portIsListening(port: number): boolean {
  for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let content: string;
    try {
      content = readFileSync(table, "utf8");
    } catch {
      continue;
    }
    for (const line of content.split("\n").slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4 || parts[3] !== "0A") continue;
      const portHex = parts[1]?.split(":")[1];
      if (portHex && parseInt(portHex, 16) === port) return true;
    }
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
    if (!groupsStillPresent(groups)) return true;
    if (Date.now() >= deadline) return false;
    await delay(EXIT_POLL_MS);
  }
}

/**
 * Group gone and `port` not in TCP LISTEN. `timeoutMs` is how long to wait
 * before reporting that the stack is still up.
 */
async function waitUntilReleased(
  groups: ReadonlySet<number>,
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    reapExitedChildren();
    if (!groupsStillPresent(groups) && !portIsListening(port)) return true;
    if (Date.now() >= deadline) return false;
    await delay(EXIT_POLL_MS);
  }
}

/**
 * Stop sequence for one recorded group. A pid whose start time differs, or
 * that does not lead the detached process group, is left unsignaled.
 * A live group gets SIGTERM, then SIGKILL after `TERM_GRACE_MS`, even when
 * this process is not its parent. The promise resolves only after the group
 * is gone and `state.port` is not listening. Past `KILL_GRACE_MS` it rejects;
 * the caller keeps the state.
 */
async function stopRecordedGroup(state: MockupStackState): Promise<void> {
  if (!isRecordedStackGroup(state)) return;
  const info = readProcInfo(state.pid);
  if (!info) return;

  const groups = new Set<number>([info.pgrp]);
  if (isMockupStackLive(state)) {
    signalGroup(state.pid, "SIGTERM");
    const releasedOnTerm = await waitUntilReleased(
      groups,
      state.port,
      TERM_GRACE_MS,
    );
    if (!releasedOnTerm) {
      signalGroup(info.pgrp, "SIGKILL");
      const releasedOnKill = await waitUntilReleased(
        groups,
        state.port,
        KILL_GRACE_MS,
      );
      if (!releasedOnKill) {
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

  reportMockupStackHeapLimit(conversationId, state.pid);

  await stopRecordedGroup(state);
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
    const ownedLive = isRecordedStackGroup(state) && isMockupStackLive(state);
    try {
      await stopRecordedGroup(state);
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
