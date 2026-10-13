import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import {
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeSync,
} from "node:fs";
import { createConnection, createServer, type AddressInfo, type Server } from "node:net";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { z } from "zod";
import type { Runtime } from "../schemas.js";
import { appendOutputTail, killProcessGroup } from "./bounded-process.js";
import { ensureChildReaper, reapExitedChildren } from "./child-reaper.js";
import { createPhaseOutputMasker } from "./agent-stack-secrets.js";

/**
 * Process boot shared by a conversation's agent stack and a review-owned
 * runtime. Ownership of the resulting record stays with the caller.
 */

const PHASE_HEAP_MB = 2048;

const READY_TIMEOUT_MS = 90_000;
const READY_POLL_MS = 250;
const READY_PROBE_TIMEOUT_MS = 5_000;
const TERM_GRACE_MS = 8_000;
const KILL_GRACE_MS = 2_000;
const EXIT_POLL_MS = 100;

export const runtimeProcessSchema = z.object({
  role: z.enum(["api", "vite", "start"]),
  pid: z.number().int().positive(),
  /**
   * `/proc/<pid>/stat` start time. Pins the pid to the process we spawned, so a
   * recycled pid in state left behind by a crash does not read as owned.
   */
  startTime: z.string().min(1),
});

export type RuntimeProcess = z.infer<typeof runtimeProcessSchema>;
export type RuntimeProcessRole = RuntimeProcess["role"];

export interface RuntimeResources {
  port: number;
  auxPort: number;
  dataDir: string;
}

const BASE_URL_VAR = /\$\{(AGENT_STACK_[A-Z0-9_]+)\}|\$(AGENT_STACK_[A-Z0-9_]+)/g;

/** The caller stopped this boot. Callers do not record it as a failure. */
export class RuntimeBootAborted extends Error {
  constructor() {
    super("runtime boot aborted");
    this.name = "RuntimeBootAborted";
  }
}

function readyTimeoutMs(): number {
  const raw = process.env.AGENT_STACK_READY_TIMEOUT_MS;
  if (raw === undefined || raw === "") return READY_TIMEOUT_MS;
  const timeout = Number(raw);
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error(
      `AGENT_STACK_READY_TIMEOUT_MS must be a positive number, got ${JSON.stringify(raw)}`,
    );
  }
  return timeout;
}

export function expandRuntimeBaseUrl(
  template: string,
  env: Record<string, string>,
): string {
  return template.replace(BASE_URL_VAR, (_match, braced: string | undefined, bare: string | undefined) => {
    const key = (braced ?? bare)!;
    const value = env[key];
    if (value === undefined) {
      throw new Error(`runtime baseUrl references unset ${key}`);
    }
    return value;
  });
}

export function runtimeVarEnv(resources: RuntimeResources): Record<string, string> {
  return {
    AGENT_STACK_PORT: String(resources.port),
    AGENT_STACK_AUX_PORT: String(resources.auxPort),
    AGENT_STACK_DATA_DIR: resources.dataDir,
  };
}

function appendNodeOptions(existing: string | undefined, ...flags: string[]): string {
  const addition = flags.join(" ");
  const trimmed = existing?.trim();
  return trimmed ? `${trimmed} ${addition}` : addition;
}

function phaseNodeOptions(dataDir: string): string {
  const heapReportDir = join(dataDir, "heap-reports");
  return appendNodeOptions(
    process.env.NODE_OPTIONS,
    `--max-old-space-size=${PHASE_HEAP_MB}`,
    "--report-on-fatalerror",
    `--report-directory=${heapReportDir}`,
  );
}

/** Linux phase shells set maximum OOM score before running the declared command. */
function wrapPhaseShellCommand(command: string): string {
  if (process.platform !== "linux") return command;
  return `echo 1000 > /proc/self/oom_score_adj; ${command}`;
}

export function phaseEnv(
  resources: RuntimeResources,
  baseUrl: string | undefined,
  secrets: Record<string, string>,
): NodeJS.ProcessEnv {
  mkdirSync(join(resources.dataDir, "heap-reports"), { recursive: true });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...secrets,
    ...runtimeVarEnv(resources),
    NODE_OPTIONS: phaseNodeOptions(resources.dataDir),
  };
  if (baseUrl === undefined) delete env.AGENT_STACK_BASE_URL;
  else env.AGENT_STACK_BASE_URL = baseUrl;
  return env;
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

/**
 * Bind both probe sockets before releasing either, so the two ports cannot come
 * back the same. The children still race whoever else is picking ports; they
 * bind with `strictPort`, so losing that race fails loudly instead of drifting.
 */
async function pickFreePortPair(): Promise<[number, number]> {
  const first = await listenOnFreePort();
  const second = await listenOnFreePort();
  const ports: [number, number] = [
    (first.address() as AddressInfo).port,
    (second.address() as AddressInfo).port,
  ];
  await Promise.all([closeServer(first), closeServer(second)]);
  return ports;
}

export async function allocateRuntimeResources(dir: string): Promise<RuntimeResources> {
  mkdirSync(dir, { recursive: true });
  const dataDir = join(dir, "data");
  mkdirSync(dataDir, { recursive: true });
  const [port, auxPort] = await pickFreePortPair();
  return { port, auxPort, dataDir };
}

export function discardRuntimeDataDir(dataDir: string): void {
  rmSync(dataDir, { recursive: true, force: true });
}

export function tailRuntimeOutput(text: string, maxLines = 20): string {
  return text.trimEnd().split("\n").slice(-maxLines).join("\n");
}

function tailLog(path: string, maxLines = 20): string {
  try {
    return tailRuntimeOutput(readFileSync(path, "utf8"), maxLines);
  } catch (err) {
    const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined;
    if (code === "ENOENT") return "";
    throw err;
  }
}

function unrefReadable(stream: Readable): void {
  if ("unref" in stream && typeof stream.unref === "function") stream.unref();
}

function streamSettled(stream: Readable): Promise<void> {
  if (stream.readableEnded) return Promise.resolve();
  return new Promise((resolve) => {
    stream.once("close", () => resolve());
    stream.once("error", () => resolve());
  });
}

/** `/proc/<pid>/stat` fields, or null when the pid is gone. */
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
export function isProcessLive(proc: RuntimeProcess): boolean {
  const info = readProcInfo(proc.pid);
  return info !== null && info.state !== "Z" && info.startTime === proc.startTime;
}

/** True when every recorded process is still the one we spawned. */
export function runtimeProcessesLive(processes: readonly RuntimeProcess[]): boolean {
  return processes.length > 0 && processes.every(isProcessLive);
}

const DECLARED_RUNTIME_FIELDS = ["start", "baseUrl"] as const;

/** Names of the runtime fields a boot requires, empty when the declaration can boot. */
export function missingDeclaredRuntimeFields(runtime: Runtime | undefined): string[] {
  return DECLARED_RUNTIME_FIELDS.filter((key) => !runtime?.[key]);
}

/** The recorded process is a child of this process (running or zombie). */
export function isOurRecordedProcess(proc: RuntimeProcess): boolean {
  const info = readProcInfo(proc.pid);
  return (
    info !== null &&
    info.ppid === process.pid &&
    info.startTime === proc.startTime
  );
}

/**
 * Spawn a stack child in its own process group (`detached`), so it outlives the
 * caller and `stop` can signal the whole tree, including children the start
 * script forks. This process writes stdout and stderr to the role log with
 * Project secret values masked.
 */
async function spawnChild(
  role: RuntimeProcessRole,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  logDir: string,
  cwd: string,
  secrets: Record<string, string>,
  label: string,
): Promise<{ child: ChildProcess; record: RuntimeProcess }> {
  const logFd = openSync(join(logDir, `${role}.log`), "w");
  const masker = createPhaseOutputMasker(secrets);
  let logClosed = false;
  const writeMasked = (chunk: Buffer | string) => {
    if (logClosed) return;
    const text = masker.push(chunk);
    if (text.length > 0) writeSync(logFd, text);
  };
  const closeLog = () => {
    if (logClosed) return;
    logClosed = true;
    const text = masker.flush();
    if (text.length > 0) writeSync(logFd, text);
    closeSync(logFd);
  };
  let child: ChildProcess;
  try {
    child = spawn(command, args, {
      cwd,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    closeLog();
    throw err;
  }
  const streams = [child.stdout, child.stderr].filter(
    (stream): stream is Readable => stream !== null,
  );
  let pendingStreams = streams.length;
  const streamDone = () => {
    pendingStreams -= 1;
    if (pendingStreams === 0) closeLog();
  };
  for (const stream of streams) {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      streamDone();
    };
    stream.on("data", writeMasked);
    stream.on("close", done);
    stream.on("error", done);
    unrefReadable(stream);
  }
  if (streams.length === 0) closeLog();
  child.unref();
  const pid = child.pid;
  if (pid === undefined) {
    closeLog();
    throw new Error(`failed to spawn ${label} ${role}`);
  }
  const info = readProcInfo(pid);
  if (info === null) {
    await Promise.all(streams.map((stream) => streamSettled(stream)));
    closeLog();
    throw new Error(
      `${label} ${role} exited immediately:\n${tailLog(join(logDir, `${role}.log`))}`,
    );
  }
  return { child, record: { role, pid, startTime: info.startTime } };
}

export function runRuntimeShell(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  secrets: Record<string, string>,
  timeoutMs?: number,
): Promise<{ code: number; output: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("sh", ["-c", wrapPhaseShellCommand(command)], {
      cwd,
      env,
      detached: timeoutMs !== undefined,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const masker = createPhaseOutputMasker(secrets);
    let output = "";
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    const append = (chunk: Buffer | string) => {
      output = appendOutputTail(output, masker.push(chunk));
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    const timer = timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          if (settled) return;
          if (child.pid !== undefined) killProcessGroup(child.pid);
        }, timeoutMs);
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      finish(() => reject(err));
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      output = appendOutputTail(output, masker.flush());
      finish(() => resolvePromise({ code: code ?? 1, output }));
    });
  });
}

async function runShellOrThrow(
  phase: string,
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  secrets: Record<string, string>,
  label: string,
): Promise<void> {
  const { code, output } = await runRuntimeShell(command, cwd, env, secrets);
  if (code !== 0) {
    throw new Error(`${label} ${phase} failed (exit ${code}):\n${tailRuntimeOutput(output)}`);
  }
}

function throwIfExited(
  logDir: string,
  spawned: { child: ChildProcess; record: RuntimeProcess },
  label: string,
): void {
  if (spawned.child.exitCode === null && spawned.child.signalCode === null) return;
  throw new Error(
    `${label} ${spawned.record.role} exited while starting:\n${tailLog(join(logDir, `${spawned.record.role}.log`))}`,
  );
}

function tcpAccepts(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    const done = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolvePromise(ok);
    };
    socket.setTimeout(READY_PROBE_TIMEOUT_MS, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

async function waitForPort(
  logDir: string,
  port: number,
  spawned: { child: ChildProcess; record: RuntimeProcess },
  label: string,
  aborted?: () => boolean,
): Promise<void> {
  const timeoutMs = readyTimeoutMs();
  const deadline = Date.now() + timeoutMs;
  let lastFailure = "no probe attempted";
  while (Date.now() < deadline) {
    if (aborted?.()) throw new RuntimeBootAborted();
    throwIfExited(logDir, spawned, label);
    if (await tcpAccepts(port)) return;
    lastFailure = `port ${port} refused`;
    await delay(READY_POLL_MS);
  }
  throw new Error(
    `${label} port ${port} did not accept connections within ${timeoutMs}ms (${lastFailure}):\n${tailLog(join(logDir, `${spawned.record.role}.log`))}`,
  );
}

async function waitForReadiness(
  logDir: string,
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  secrets: Record<string, string>,
  spawned: { child: ChildProcess; record: RuntimeProcess },
  label: string,
  aborted?: () => boolean,
): Promise<void> {
  const timeoutMs = readyTimeoutMs();
  const deadline = Date.now() + timeoutMs;
  let lastOutput = "";
  let lastCode = "none";
  while (Date.now() < deadline) {
    if (aborted?.()) throw new RuntimeBootAborted();
    throwIfExited(logDir, spawned, label);
    const remaining = Math.max(1, deadline - Date.now());
    const { code, output } = await runRuntimeShell(command, cwd, env, secrets, remaining);
    lastOutput = output;
    lastCode = String(code);
    if (code === 0) return;
    await delay(READY_POLL_MS);
  }
  throw new Error(
    `${label} readiness was not ready within ${timeoutMs}ms (exit ${lastCode}):\n${tailRuntimeOutput(lastOutput)}`,
  );
}

export interface RuntimeBootSpec {
  logDir: string;
  resources: RuntimeResources;
  worktree: string;
  runtime: Runtime;
  secrets: Record<string, string>;
  /** Error text names this owner. Agent stacks keep the historical "agent stack". */
  label?: string;
  aborted?: () => boolean;
  /** Called after the start process is spawned and before readiness. */
  onSpawned?: (process: RuntimeProcess, baseUrl: string) => void;
}

/**
 * Run build, start, port wait, seed, and readiness in the worktree.
 * Does not record ownership and does not clean up after a thrown failure.
 */
export async function bootRuntime(
  spec: RuntimeBootSpec,
): Promise<{ baseUrl: string; process: RuntimeProcess }> {
  ensureChildReaper();
  const label = spec.label ?? "agent stack";
  const { resources, runtime, secrets, worktree, logDir } = spec;
  const throwIfAborted = () => {
    if (spec.aborted?.()) throw new RuntimeBootAborted();
  };
  throwIfAborted();
  if (!runtime.baseUrl || !runtime.start) {
    throw new Error(`${label} runtime is missing start and baseUrl`);
  }
  const baseUrl = expandRuntimeBaseUrl(runtime.baseUrl, runtimeVarEnv(resources));
  throwIfAborted();
  if (runtime.build) {
    await runShellOrThrow(
      "build",
      runtime.build,
      worktree,
      phaseEnv(resources, undefined, secrets),
      secrets,
      label,
    );
  }
  throwIfAborted();
  const spawned = await spawnChild(
    "start",
    "sh",
    ["-c", wrapPhaseShellCommand(runtime.start)],
    phaseEnv(resources, undefined, secrets),
    logDir,
    worktree,
    secrets,
    label,
  );
  spec.onSpawned?.(spawned.record, baseUrl);
  throwIfAborted();
  await waitForPort(logDir, resources.port, spawned, label, spec.aborted);
  if (runtime.seed) {
    throwIfAborted();
    await runShellOrThrow(
      "seed",
      runtime.seed,
      worktree,
      phaseEnv(resources, baseUrl, secrets),
      secrets,
      label,
    );
  }
  if (runtime.readiness) {
    throwIfAborted();
    await waitForReadiness(
      logDir,
      runtime.readiness,
      worktree,
      phaseEnv(resources, baseUrl, secrets),
      secrets,
      spawned,
      label,
      spec.aborted,
    );
  }
  throwIfAborted();
  return { baseUrl, process: spawned.record };
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
 * Stop recorded processes. A pid that is not this process's child is left
 * unsignaled. Owned live groups get SIGTERM, then SIGKILL after `TERM_GRACE_MS`.
 * The promise settles only after `waitpid` collects the group. Past
 * `KILL_GRACE_MS` it keeps waiting, then rejects. `label` names the owner in
 * that error.
 */
export async function stopRuntimeProcesses(
  processes: readonly RuntimeProcess[],
  label: string,
): Promise<void> {
  ensureChildReaper();
  const owned = processes.filter(isOurRecordedProcess);
  const live = owned.filter(isProcessLive);
  const groups = new Set<number>();
  for (const proc of owned) {
    const info = readProcInfo(proc.pid);
    if (info) groups.add(info.pgrp);
  }

  if (live.length > 0) {
    for (const proc of live) killProcessGroup(proc.pid, "SIGTERM");
    const collectedOnTerm = await waitUntilGroupsCollected(groups, TERM_GRACE_MS);
    if (!collectedOnTerm) {
      for (const pgrp of groups) killProcessGroup(pgrp, "SIGKILL");
      const collectedOnKill = await waitUntilGroupsCollected(groups, KILL_GRACE_MS);
      if (!collectedOnKill) {
        const survivors = owned.filter(isOurRecordedProcess);
        await waitUntilGroupsCollected(groups, Number.POSITIVE_INFINITY);
        throw new Error(
          `${label} survived SIGKILL: ${
            survivors.map((proc) => `${proc.role}(${proc.pid})`).join(", ") ||
            "group still uncollected"
          }`,
        );
      }
    }
  } else if (groups.size > 0) {
    await waitUntilGroupsCollected(groups, Number.POSITIVE_INFINITY);
  }
}
