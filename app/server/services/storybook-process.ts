import { spawn, type ChildProcess } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { createServer, type AddressInfo, type Server } from "node:net";
import { appDir } from "../config.js";
import { killProcessGroup } from "./bounded-process.js";
import { reapExitedChildren } from "./child-reaper.js";

/**
 * One plugin-app Storybook dev server on loopback, detached into its own
 * process group. A conversation's mockup stack and an outline's replay tree
 * each run one; callers own where its log, heap reports, and state live.
 */

const MOCKUP_HEAP_MB = 2048;
const HEAP_OOM_EVENT = "Allocation failed - JavaScript heap out of memory";

const READY_TIMEOUT_MS = 90_000;
const READY_POLL_MS = 250;
const READY_PROBE_TIMEOUT_MS = 5_000;
const TERM_GRACE_MS = 8_000;
const KILL_GRACE_MS = 2_000;
const EXIT_POLL_MS = 100;

/** A spawned Storybook, pinned to its pid by `/proc` start time. */
export interface StorybookProcessRecord {
  port: number;
  pid: number;
  startTime: string;
}

export interface StorybookSpawnOptions {
  logPath: string;
  heapReportDir: string;
  port: number;
  harnessPath: string;
  /** Public prefix the manager, preview iframe, and HMR client resolve on; omitted serves loopback only. */
  base?: string;
}

export interface SpawnedStorybook {
  child: ChildProcess;
  pid: number;
  startTime: string;
}

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

/** Logs the memory-limit line when `pid` left a heap-exhaustion report. */
export function reportStorybookHeapLimit(heapReportDir: string, pid: number): void {
  if (!hasHeapLimitReportForPid(heapReportDir, pid)) {
    return;
  }
  console.error(mockupStackMemoryLimitMessage());
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function readProcInfo(
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
export function isRecordedProcessLive(record: { pid: number; startTime: string }): boolean {
  const info = readProcInfo(record.pid);
  return info !== null && info.state !== "Z" && info.startTime === record.startTime;
}

/**
 * The recorded pid still leads the process group created by the detached
 * spawn, pinned by its `/proc` start time. Parentage is not ownership: the
 * CLI exits and the group is reparented.
 */
export function isRecordedStorybookGroup(record: StorybookProcessRecord): boolean {
  const info = readProcInfo(record.pid);
  return (
    info !== null &&
    info.startTime === record.startTime &&
    info.pgrp === record.pid
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

export async function pickFreePort(): Promise<number> {
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

export function tailLines(text: string, maxLines = 20): string {
  return text.trimEnd().split("\n").slice(-maxLines).join("\n");
}

export function tailLog(path: string, maxLines = 20): string {
  return existsSync(path) ? tailLines(readFileSync(path, "utf8"), maxLines) : "";
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

/** The start command as a human would type it from `app/`. */
export function storybookStartCommand(port: number): string {
  return ["storybook", ...storybookDevArgs(port)].join(" ");
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

export function spawnStorybook(options: StorybookSpawnOptions): SpawnedStorybook {
  const { logPath, heapReportDir, port, harnessPath, base } = options;
  mkdirSync(heapReportDir, { recursive: true });
  const storybookBin = binPath("storybook");
  const args = storybookDevArgs(port);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MOCKUP_HARNESS_CONFIG: harnessPath,
    NODE_OPTIONS: storybookNodeOptions(heapReportDir),
  };
  if (base === undefined) delete env.MOCKUP_STORYBOOK_BASE;
  else env.MOCKUP_STORYBOOK_BASE = base;
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

/** Resolves once `baseUrl` answers OK; rejects when the child exits or the deadline passes. */
export async function waitForStorybookReady(options: {
  label: string;
  logPath: string;
  baseUrl: string;
  child: ChildProcess;
}): Promise<void> {
  const { label, logPath, baseUrl, child } = options;
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastFailure = "no probe attempted";
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `mockup stack storybook exited while starting:\n${tailLog(logPath)}`,
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
    `mockup stack for ${label} was not ready within ${READY_TIMEOUT_MS}ms (${lastFailure})`,
  );
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
 * is gone and `record.port` is not listening. Past `KILL_GRACE_MS` it rejects;
 * the caller keeps the state.
 */
export async function stopStorybookGroup(record: StorybookProcessRecord): Promise<void> {
  if (!isRecordedStorybookGroup(record)) return;
  const info = readProcInfo(record.pid);
  if (!info) return;

  const groups = new Set<number>([info.pgrp]);
  if (isRecordedProcessLive(record)) {
    killProcessGroup(record.pid, "SIGTERM");
    const releasedOnTerm = await waitUntilReleased(
      groups,
      record.port,
      TERM_GRACE_MS,
    );
    if (!releasedOnTerm) {
      killProcessGroup(info.pgrp, "SIGKILL");
      const releasedOnKill = await waitUntilReleased(
        groups,
        record.port,
        KILL_GRACE_MS,
      );
      if (!releasedOnKill) {
        throw new Error(
          `mockup stack survived SIGKILL (pid ${record.pid}, port ${record.port})`,
        );
      }
    }
    return;
  }

  await waitUntilGroupsCollected(groups, Number.POSITIVE_INFINITY);
}
