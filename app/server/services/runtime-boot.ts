import { spawn, type ChildProcess } from "node:child_process";
import { addAbortListener } from "node:events";
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

/** The boot phase whose process group is active, from the moment its shell spawns. */
export const runtimeBootPhaseReportSchema = z.object({
  phase: z.enum(["build", "start", "seed", "readiness"]),
  startedAt: z.string().min(1),
  process: runtimeProcessSchema.pick({ pid: true, startTime: true }),
});

export type RuntimeBootPhaseReport = z.infer<typeof runtimeBootPhaseReportSchema>;
type ShellPhase = Exclude<RuntimeBootPhaseReport["phase"], "start">;
type ProcessIdentity = RuntimeBootPhaseReport["process"];

export interface RuntimeResources {
  port: number;
  auxPort: number;
  dataDir: string;
}

const BASE_URL_VAR = /\$\{(AGENT_STACK_[A-Z0-9_]+)\}|\$(AGENT_STACK_[A-Z0-9_]+)/g;

/**
 * The caller aborted this boot and its process groups are collected. Callers
 * do not record it as a failure.
 */
export class RuntimeBootCancelled extends Error {
  constructor() {
    super("runtime boot cancelled");
    this.name = "RuntimeBootCancelled";
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

export type RuntimeBootPhase = RuntimeBootPhaseReport["phase"];

export function runtimeBootPhaseLogFilename(phase: RuntimeBootPhase): string {
  if (phase === "build" || phase === "seed") return `${phase}.log`;
  return "start.log";
}

/** Role log path for a boot phase (`start.log` covers start and readiness). */
export function runtimeBootPhaseLogFile(logDir: string, phase: RuntimeBootPhase): string {
  return join(logDir, runtimeBootPhaseLogFilename(phase));
}

/** Last lines of a phase log file, split for JSON APIs. */
export function readRuntimeBootPhaseLogLines(
  logDir: string,
  phase: RuntimeBootPhase,
  maxLines = 200,
): string[] {
  const text = tailLog(runtimeBootPhaseLogFile(logDir, phase), maxLines);
  return text ? text.split("\n") : [];
}

export function runtimeBootPhaseLogBasename(phase: RuntimeBootPhase): string {
  return runtimeBootPhaseLogFilename(phase);
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

/** Masked stdout/stderr appended to one role log file (`start.log`, `build.log`, …). */
function openMaskedRoleLog(secrets: Record<string, string>, logPath: string) {
  const logFd = openSync(logPath, "w");
  const masker = createPhaseOutputMasker(secrets);
  let closed = false;
  const write = (text: string) => {
    if (!closed && text.length > 0) writeSync(logFd, text);
  };
  return {
    push(chunk: Buffer | string): string {
      if (closed) return "";
      const text = masker.push(chunk);
      write(text);
      return text;
    },
    flush(): string {
      if (closed) return "";
      const text = masker.flush();
      write(text);
      return text;
    },
    close(): void {
      if (closed) return;
      const tail = masker.flush();
      closed = true;
      if (tail.length > 0) writeSync(logFd, tail);
      closeSync(logFd);
    },
  };
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
  const roleLog = openMaskedRoleLog(secrets, join(logDir, `${role}.log`));
  const writeMasked = (chunk: Buffer | string) => {
    roleLog.push(chunk);
  };
  const closeLog = () => roleLog.close();
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

type ShellResult = { code: number; output: string };

/** `detached` puts the shell in its own process group, led by its pid. */
function spawnRuntimeShell(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  secrets: Record<string, string>,
  detached: boolean,
  logFilePath?: string,
): { child: ChildProcess; result: Promise<ShellResult> } {
  const roleLog =
    logFilePath === undefined ? undefined : openMaskedRoleLog(secrets, logFilePath);
  const memoryMasker = roleLog === undefined ? createPhaseOutputMasker(secrets) : undefined;
  let child: ChildProcess;
  try {
    child = spawn("sh", ["-c", wrapPhaseShellCommand(command)], {
      cwd,
      env,
      detached,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    roleLog?.close();
    throw err;
  }
  const result = new Promise<ShellResult>((resolvePromise, reject) => {
    let output = "";
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    const append = (chunk: Buffer | string) => {
      if (roleLog) {
        roleLog.push(chunk);
        return;
      }
      output = appendOutputTail(output, memoryMasker!.push(chunk));
    };
    const flushOutput = () => {
      if (roleLog) {
        roleLog.flush();
        roleLog.close();
        return;
      }
      output = appendOutputTail(output, memoryMasker!.flush());
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.on("error", (err) => finish(() => {
      flushOutput();
      reject(err);
    }));
    child.on("close", (code) => {
      flushOutput();
      finish(() => resolvePromise({ code: code ?? 1, output }));
    });
  });
  return { child, result };
}

export function runRuntimeShell(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  secrets: Record<string, string>,
): Promise<ShellResult> {
  return spawnRuntimeShell(command, cwd, env, secrets, false).result;
}

/** Settles with `work`, or rejects with the abort reason as soon as `signal` aborts. */
function unlessAborted<T>(signal: AbortSignal, work: Promise<T>): Promise<T> {
  return new Promise((resolvePromise, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const listener = addAbortListener(signal, () => reject(signal.reason));
    work.then(resolvePromise, reject).finally(() => listener[Symbol.dispose]());
  });
}

/** One boot's cancellation state, shared by every phase it runs. */
interface BootControl {
  signal: AbortSignal;
  /** Process groups the boot must collect before it reports cancellation. */
  groups: Set<number>;
  onPhase?: (report: RuntimeBootPhaseReport) => void;
  /** Elapsed time anchor for the current `reportedPhase` (stable across readiness probes). */
  reportedPhase?: RuntimeBootPhaseReport["phase"];
  reportedPhaseStartedAt?: string;
}

function reportPhase(
  control: BootControl,
  phase: RuntimeBootPhaseReport["phase"],
  process: ProcessIdentity,
): void {
  control.groups.add(process.pid);
  if (control.reportedPhase !== phase) {
    control.reportedPhase = phase;
    control.reportedPhaseStartedAt = new Date().toISOString();
  }
  control.onPhase?.({
    phase,
    startedAt: control.reportedPhaseStartedAt!,
    process,
  });
}

/**
 * Run one phase shell in its own process group. The group stays in
 * `control.groups` until the shell settles, so an abort meanwhile leaves it
 * for the boot to collect. `timeoutMs` kills the group and lets the shell
 * settle with its exit status.
 */
function shellPhaseLogFile(logDir: string, phase: ShellPhase): string | undefined {
  if (phase === "readiness") return undefined;
  return runtimeBootPhaseLogFile(logDir, phase);
}

async function runPhaseShell(
  control: BootControl,
  phase: ShellPhase,
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  secrets: Record<string, string>,
  logDir: string,
  timeoutMs?: number,
): Promise<ShellResult> {
  control.signal.throwIfAborted();
  const { child, result } = spawnRuntimeShell(
    command,
    cwd,
    env,
    secrets,
    true,
    shellPhaseLogFile(logDir, phase),
  );
  const pid = child.pid;
  if (pid === undefined) return result;
  // The shell cannot be reaped before this synchronous read, so it is present
  // even when the command has already exited.
  const info = readProcInfo(pid)!;
  reportPhase(control, phase, { pid, startTime: info.startTime });
  const timer = timeoutMs === undefined ? undefined : setTimeout(() => killProcessGroup(pid), timeoutMs);
  try {
    const settled = await unlessAborted(control.signal, result);
    control.groups.delete(pid);
    return settled;
  } finally {
    clearTimeout(timer);
  }
}

async function runPhaseOrThrow(
  control: BootControl,
  phase: "build" | "seed",
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  secrets: Record<string, string>,
  label: string,
  logDir: string,
): Promise<void> {
  const { code } = await runPhaseShell(control, phase, command, cwd, env, secrets, logDir);
  if (code !== 0) {
    throw new Error(
      `${label} ${phase} failed (exit ${code}):\n${tailLog(shellPhaseLogFile(logDir, phase)!)}`,
    );
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
  signal: AbortSignal,
): Promise<void> {
  const timeoutMs = readyTimeoutMs();
  const deadline = Date.now() + timeoutMs;
  let lastFailure = "no probe attempted";
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    throwIfExited(logDir, spawned, label);
    if (await tcpAccepts(port)) return;
    lastFailure = `port ${port} refused`;
    await delay(READY_POLL_MS, undefined, { signal });
  }
  throw new Error(
    `${label} port ${port} did not accept connections within ${timeoutMs}ms (${lastFailure}):\n${tailLog(join(logDir, `${spawned.record.role}.log`))}`,
  );
}

async function waitForReadiness(
  control: BootControl,
  logDir: string,
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  secrets: Record<string, string>,
  spawned: { child: ChildProcess; record: RuntimeProcess },
  label: string,
): Promise<void> {
  const timeoutMs = readyTimeoutMs();
  const deadline = Date.now() + timeoutMs;
  let lastOutput = "";
  let lastCode = "none";
  while (Date.now() < deadline) {
    throwIfExited(logDir, spawned, label);
    const remaining = Math.max(1, deadline - Date.now());
    const { code, output } = await runPhaseShell(
      control,
      "readiness",
      command,
      cwd,
      env,
      secrets,
      logDir,
      remaining,
    );
    lastOutput = output;
    lastCode = String(code);
    if (code === 0) return;
    await delay(READY_POLL_MS, undefined, { signal: control.signal });
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
  /** Aborting cancels the boot in whichever phase is active. */
  signal: AbortSignal;
  /** Called as each phase shell spawns, including every readiness probe. */
  onPhase?: (report: RuntimeBootPhaseReport) => void;
  /** Called after the start process is spawned and before readiness. */
  onSpawned?: (process: RuntimeProcess, baseUrl: string) => void;
}

/**
 * Run build, start, port wait, seed, and readiness in the worktree, each phase
 * shell in its own process group. Does not record ownership and does not clean
 * up after a thrown failure. When `signal` aborts, it terminates the active
 * phase's group and the start group, and rejects with `RuntimeBootCancelled`
 * once `waitpid` collects them.
 */
export async function bootRuntime(
  spec: RuntimeBootSpec,
): Promise<{ baseUrl: string; process: RuntimeProcess }> {
  ensureChildReaper();
  const label = spec.label ?? "agent stack";
  const { resources, runtime, secrets, worktree, logDir, signal } = spec;
  const control: BootControl = { signal, groups: new Set(), onPhase: spec.onPhase };
  try {
    signal.throwIfAborted();
    if (!runtime.baseUrl || !runtime.start) {
      throw new Error(`${label} runtime is missing start and baseUrl`);
    }
    const baseUrl = expandRuntimeBaseUrl(runtime.baseUrl, runtimeVarEnv(resources));
    if (runtime.build) {
      await runPhaseOrThrow(
        control,
        "build",
        runtime.build,
        worktree,
        phaseEnv(resources, undefined, secrets),
        secrets,
        label,
        logDir,
      );
    }
    signal.throwIfAborted();
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
    reportPhase(control, "start", {
      pid: spawned.record.pid,
      startTime: spawned.record.startTime,
    });
    spec.onSpawned?.(spawned.record, baseUrl);
    await waitForPort(logDir, resources.port, spawned, label, signal);
    if (runtime.seed) {
      await runPhaseOrThrow(
        control,
        "seed",
        runtime.seed,
        worktree,
        phaseEnv(resources, baseUrl, secrets),
        secrets,
        label,
        logDir,
      );
    }
    if (runtime.readiness) {
      await waitForReadiness(
        control,
        logDir,
        runtime.readiness,
        worktree,
        phaseEnv(resources, baseUrl, secrets),
        secrets,
        spawned,
        label,
      );
    }
    signal.throwIfAborted();
    return { baseUrl, process: spawned.record };
  } catch (err) {
    if (!signal.aborted) throw err;
    await terminateProcessGroups(control.groups, label, () =>
      [...control.groups].map((pgrp) => `group ${pgrp}`).join(", "),
    );
    throw new RuntimeBootCancelled();
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
 * SIGTERM each group, then SIGKILL after `TERM_GRACE_MS`. The promise settles
 * only after `waitpid` collects every group. Past `KILL_GRACE_MS` it keeps
 * waiting, then rejects naming `survivors()`. `label` names the owner in that
 * error.
 */
async function terminateProcessGroups(
  groups: ReadonlySet<number>,
  label: string,
  survivors: () => string,
): Promise<void> {
  for (const pgrp of groups) killProcessGroup(pgrp, "SIGTERM");
  if (await waitUntilGroupsCollected(groups, TERM_GRACE_MS)) return;
  for (const pgrp of groups) killProcessGroup(pgrp, "SIGKILL");
  if (await waitUntilGroupsCollected(groups, KILL_GRACE_MS)) return;
  const named = survivors() || "group still uncollected";
  await waitUntilGroupsCollected(groups, Number.POSITIVE_INFINITY);
  throw new Error(`${label} survived SIGKILL: ${named}`);
}

/**
 * Stop recorded processes. A pid that is not this process's child is left
 * unsignaled. Owned live groups are terminated per `terminateProcessGroups`.
 */
export async function stopRuntimeProcesses(
  processes: readonly RuntimeProcess[],
  label: string,
): Promise<void> {
  ensureChildReaper();
  const owned = processes.filter(isOurRecordedProcess);
  const groups = new Set<number>();
  for (const proc of owned) {
    const info = readProcInfo(proc.pid);
    if (info) groups.add(info.pgrp);
  }

  if (owned.some(isProcessLive)) {
    await terminateProcessGroups(groups, label, () =>
      // Read after the SIGKILL grace, so it names only what is still uncollected.
      owned
        .filter(isOurRecordedProcess)
        .map((proc) => `${proc.role}(${proc.pid})`)
        .join(", "),
    );
  } else if (groups.size > 0) {
    await waitUntilGroupsCollected(groups, Number.POSITIVE_INFINITY);
  }
}
