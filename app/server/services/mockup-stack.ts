import { spawn, type ChildProcess } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { createServer, type AddressInfo, type Server } from "node:net";
import { appDir } from "../config.js";
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
  removeMockupScratch,
  writeMockupStackState,
  type MockupStackState,
} from "./mockup-scratch.js";

/**
 * A conversation's Storybook dev server on a port picked free at start time.
 * Agents run mockup rounds here instead of on the human's stack.
 */

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
  /** State files removed for dead or pid-recycled stacks. */
  staleStateRemoved: string[];
  /** Live stacks stopped and scratch removed because the conversation is gone. */
  orphanedStacksStopped: MockupStackStopAllEntry[];
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readProcInfo(pid: number): { state: string; startTime: string } | null {
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
  if (!state || !startTime) {
    throw new Error(`unparseable /proc/${pid}/stat`);
  }
  return { state, startTime };
}

/** True when the recorded pid is still the process we spawned, and not a zombie. */
export function isMockupStackLive(state: MockupStackState): boolean {
  const info = readProcInfo(state.pid);
  return info !== null && info.state !== "Z" && info.startTime === state.startTime;
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

function spawnStorybook(
  conversationId: string,
  port: number,
  harnessPath: string,
): { child: ChildProcess; pid: number; startTime: string } {
  const logPath = mockupStackLogPath(conversationId);
  const fd = openSync(logPath, "w");
  let child: ChildProcess;
  try {
    child = spawn(
      binPath("storybook"),
      ["dev", "-c", ".storybook", "--no-open", "--ci", "--port", String(port)],
      {
        cwd: appDir,
        env: {
          ...process.env,
          MOCKUP_HARNESS_CONFIG: harnessPath,
        },
        detached: true,
        stdio: ["ignore", fd, fd],
      },
    );
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
  const existing = readMockupStackState(conversationId);
  if (existing) {
    if (isMockupStackLive(existing)) {
      return { state: existing, reused: true };
    }
    await stopMockupStack(conversationId);
  }

  const harnessPath = assertHarnessConfig(conversationId);
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

async function waitForExit(
  state: MockupStackState,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isMockupStackLive(state)) return true;
    await delay(EXIT_POLL_MS);
  }
  return !isMockupStackLive(state);
}

async function stopLiveProcess(state: MockupStackState): Promise<void> {
  if (!isMockupStackLive(state)) return;

  signalGroup(state.pid, "SIGTERM");
  const exited = await waitForExit(state, TERM_GRACE_MS);
  if (!exited) {
    signalGroup(state.pid, "SIGKILL");
    const killed = await waitForExit(state, KILL_GRACE_MS);
    if (!killed) {
      throw new Error(
        `mockup stack survived SIGKILL (pid ${state.pid}, port ${state.port})`,
      );
    }
  }
}

function removeMockupStackState(conversationId: string): void {
  rmSync(mockupStackStatePathDirect(conversationId), { force: true });
}

/**
 * Stop this conversation's Storybook stack and release its port. A
 * conversation with no recorded stack is not an error.
 */
export async function stopMockupStack(
  conversationId: string,
): Promise<MockupStackStopResult> {
  const state = readMockupStackState(conversationId);
  if (!state) return { stopped: false, state: null };

  await stopLiveProcess(state);
  rmSync(mockupStackStatePath(conversationId), { force: true });
  return { stopped: true, state };
}

/**
 * Stop every recorded mockup stack. Returns each live stack's freed port.
 */
export async function stopAllMockupStacks(): Promise<MockupStackStopAllEntry[]> {
  const freed: MockupStackStopAllEntry[] = [];
  for (const conversationId of listRecordedMockupStackIds()) {
    const state = readMockupStackStateDirect(conversationId);
    if (!state) continue;
    const wasLive = isMockupStackLive(state);
    await stopLiveProcess(state);
    removeMockupStackState(conversationId);
    if (wasLive) {
      freed.push({ conversationId, port: state.port });
    }
  }
  return freed;
}

/**
 * Sweep recorded mockup stacks at API boot. Stale state is dropped without
 * signaling; live stacks whose conversation no longer exists are stopped and
 * their scratch removed. Scratch for conversations that still exist is never
 * removed here.
 */
export async function reapOrphanedMockupStacksAtBoot(): Promise<MockupStackReapReport> {
  const report: MockupStackReapReport = {
    staleStateRemoved: [],
    orphanedStacksStopped: [],
  };

  for (const conversationId of listRecordedMockupStackIds()) {
    const state = readMockupStackStateDirect(conversationId);
    if (!state) continue;

    if (!isMockupStackLive(state)) {
      removeMockupStackState(conversationId);
      report.staleStateRemoved.push(conversationId);
      continue;
    }

    if (conversationMetaExists(conversationId)) {
      continue;
    }

    await stopLiveProcess(state);
    removeMockupScratch(conversationId);
    report.orphanedStacksStopped.push({
      conversationId,
      port: state.port,
    });
  }

  return report;
}
