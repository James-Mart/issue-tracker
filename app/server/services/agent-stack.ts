import { spawn, type ChildProcess } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createConnection, createServer, type AddressInfo, type Server } from "node:net";
import { join, resolve } from "node:path";
import { z } from "zod";
import { appDir, conversationsDir, issuesDir } from "../config.js";
import type { Issue, Runtime } from "../schemas.js";
import { isSlugSafe } from "../slug.js";
import { ensureChildReaper, reapExitedChildren } from "./child-reaper.js";
import { readAll } from "./issues.js";
import { ancestorChain } from "./subtree.js";

/**
 * A conversation's own API + Vite pair, on ports picked free at start time.
 * Agents verify server/UI changes here instead of on the human's stack, so
 * watch mode is deliberate: this stack hosts no agent sessions and a reload
 * cancels nothing.
 */

const READY_TIMEOUT_MS = 90_000;
const READY_POLL_MS = 250;
const READY_PROBE_TIMEOUT_MS = 5_000;
const TERM_GRACE_MS = 8_000;
const KILL_GRACE_MS = 2_000;
const EXIT_POLL_MS = 100;

const agentStackProcessSchema = z.object({
  role: z.enum(["api", "vite", "start"]),
  pid: z.number().int().positive(),
  /**
   * `/proc/<pid>/stat` start time. Pins the pid to the process we spawned, so a
   * recycled pid in state left behind by a crash does not read as owned.
   */
  startTime: z.string().min(1),
});

const agentStackStateSchema = z.object({
  conversationId: z.string().min(1),
  /** Issue whose Story worktree this stack booted. */
  issueId: z.string().min(1),
  /** Absolute Story worktree this stack booted. */
  worktree: z.string().min(1),
  /** Primary port (`AGENT_STACK_PORT`); the base URL points at it. */
  port: z.number().int().positive(),
  /** Second free port (`AGENT_STACK_AUX_PORT`). */
  auxPort: z.number().int().positive(),
  /** This stack's data directory, created on start and removed on stop. */
  dataDir: z.string().min(1),
  baseUrl: z.string().min(1),
  startedAt: z.string().min(1),
  processes: z.array(agentStackProcessSchema),
  /**
   * Cursor runtime `conversation_id` values (each session's agentId) that have
   * an `agent-stack-cursor-index` entry pointing at this app conversation.
   */
  cursorConversationIds: z.array(z.string().min(1)).default([]),
});

export type AgentStackRole = z.infer<typeof agentStackProcessSchema>["role"];
export type AgentStackProcess = z.infer<typeof agentStackProcessSchema>;
export type AgentStackState = z.infer<typeof agentStackStateSchema>;

export interface AgentStackStartOptions {
  /**
   * Issue whose Story (itself, or its containing Story) supplies the live
   * worktree to boot.
   */
  issueId: string;
  /**
   * Cursor `conversation_id` for the calling session — the same value
   * `preToolUse` hooks receive on stdin. Required for the kill-guard index.
   */
  cursorConversationId?: string;
}

export interface AgentStackHandle {
  state: AgentStackState;
  /** Caller-facing env contract, keyed by the exact variable names. */
  env: Record<string, string>;
  /** True when a live stack for this conversation was already running. */
  reused: boolean;
}

/** `stopped: false` means no stack was recorded for the conversation. */
export type AgentStackStopResult =
  | { stopped: true; state: AgentStackState }
  | { stopped: false; state: null };

function assertConversationId(conversationId: string): void {
  if (!isSlugSafe(conversationId)) {
    throw new Error(
      `agent stack conversationId must be a slug, got ${JSON.stringify(conversationId)}`,
    );
  }
}

function assertCursorConversationId(cursorConversationId: string): void {
  if (!isSlugSafe(cursorConversationId)) {
    throw new Error(
      `agent stack cursorConversationId must be a slug, got ${JSON.stringify(cursorConversationId)}`,
    );
  }
}

/** Peer of the conversation's `agent-state/`. */
export function agentStackDir(conversationId: string): string {
  assertConversationId(conversationId);
  return join(conversationsDir, conversationId, "agent-stack");
}

export function agentStackStatePath(conversationId: string): string {
  return join(agentStackDir(conversationId), "state.json");
}

/** Disk index the kill-guard reads without talking to the live server. */
export function agentStackCursorIndexDir(): string {
  return join(conversationsDir, "agent-stack-cursor-index");
}

export function agentStackCursorIndexPath(cursorConversationId: string): string {
  assertCursorConversationId(cursorConversationId);
  return join(agentStackCursorIndexDir(), `${cursorConversationId}.json`);
}

function writeCursorIndex(
  cursorConversationId: string,
  appConversationId: string,
): void {
  assertCursorConversationId(cursorConversationId);
  assertConversationId(appConversationId);
  mkdirSync(agentStackCursorIndexDir(), { recursive: true });
  writeFileSync(
    agentStackCursorIndexPath(cursorConversationId),
    `${JSON.stringify({ appConversationId }, null, 2)}\n`,
  );
}

function removeCursorIndex(cursorConversationId: string): void {
  assertCursorConversationId(cursorConversationId);
  rmSync(agentStackCursorIndexPath(cursorConversationId), { force: true });
}

function rememberCursorConversationId(
  state: AgentStackState,
  cursorConversationId: string,
): AgentStackState {
  assertCursorConversationId(cursorConversationId);
  if (state.cursorConversationIds.includes(cursorConversationId)) {
    writeCursorIndex(cursorConversationId, state.conversationId);
    return state;
  }
  const next: AgentStackState = {
    ...state,
    cursorConversationIds: [...state.cursorConversationIds, cursorConversationId],
  };
  writeAgentStackState(next);
  writeCursorIndex(cursorConversationId, state.conversationId);
  return next;
}

function clearCursorIndexes(state: AgentStackState): void {
  for (const cursorConversationId of state.cursorConversationIds) {
    removeCursorIndex(cursorConversationId);
  }
}

function logPath(conversationId: string, role: AgentStackRole): string {
  return join(agentStackDir(conversationId), `${role}.log`);
}

export function agentStackEnv(state: AgentStackState): Record<string, string> {
  return {
    AGENT_STACK_PORT: String(state.port),
    AGENT_STACK_AUX_PORT: String(state.auxPort),
    AGENT_STACK_DATA_DIR: state.dataDir,
    AGENT_STACK_BASE_URL: state.baseUrl,
  };
}

export function readAgentStackState(
  conversationId: string,
): AgentStackState | null {
  const path = agentStackStatePath(conversationId);
  if (!existsSync(path)) return null;
  const parsed = agentStackStateSchema.safeParse(
    JSON.parse(readFileSync(path, "utf8")),
  );
  if (!parsed.success) {
    throw new Error(
      `invalid agent-stack state at ${path}: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

function writeAgentStackState(state: AgentStackState): void {
  writeFileSync(
    agentStackStatePath(state.conversationId),
    `${JSON.stringify(state, null, 2)}\n`,
  );
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
export function isProcessLive(proc: AgentStackProcess): boolean {
  const info = readProcInfo(proc.pid);
  return info !== null && info.state !== "Z" && info.startTime === proc.startTime;
}

/** The recorded process is a child of this process (running or zombie). */
function isOurRecordedProcess(proc: AgentStackProcess): boolean {
  const info = readProcInfo(proc.pid);
  return (
    info !== null &&
    info.ppid === process.pid &&
    info.startTime === proc.startTime
  );
}

/** True when every recorded process of the stack is still live. */
export function isStackLive(state: AgentStackState): boolean {
  return state.processes.length > 0 && state.processes.every(isProcessLive);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function workspaceAppDir(worktree: string): string {
  return join(worktree, "app");
}

function hostAsrModelDir(): string {
  return process.env.ISSUE_TRACKER_ASR_MODEL_DIR ?? join(appDir, ".asr-models");
}

function binPath(name: string, cwdAppDir: string): string {
  const bin = join(cwdAppDir, "node_modules", ".bin", name);
  if (!existsSync(bin)) {
    throw new Error(`missing ${bin} — run \`npm install\` from \`${cwdAppDir}\``);
  }
  return bin;
}

async function runNpmInstall(cwdAppDir: string, asrModelDir: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn("npm", ["install"], {
      cwd: cwdAppDir,
      env: {
        ...process.env,
        ISSUE_TRACKER_SKIP_BROWSER_SETUP: "1",
        ISSUE_TRACKER_SKIP_ASR_MODEL_SETUP: "1",
        ISSUE_TRACKER_ASR_MODEL_DIR: asrModelDir,
      },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise();
      else {
        reject(
          new Error(
            `npm install in ${cwdAppDir} exited with code ${code ?? "unknown"}`,
          ),
        );
      }
    });
  });
}

async function ensureWorkspaceAppReady(
  workspace: string,
  asrModelDir: string,
): Promise<string> {
  const cwdAppDir = workspaceAppDir(workspace);
  if (!existsSync(cwdAppDir) || !statSync(cwdAppDir).isDirectory()) {
    throw new Error(`agent stack worktree has no app/ directory: ${cwdAppDir}`);
  }
  if (!existsSync(join(cwdAppDir, "node_modules"))) {
    await runNpmInstall(cwdAppDir, asrModelDir);
  }
  return cwdAppDir;
}

function tailText(text: string, maxLines = 20): string {
  return text.trimEnd().split("\n").slice(-maxLines).join("\n");
}

function tailLog(path: string, maxLines = 20): string {
  if (!existsSync(path)) return "";
  return tailText(readFileSync(path, "utf8"), maxLines);
}

/**
 * Spawn a stack child in its own process group (`detached`), so it outlives the
 * caller and `stop` can signal the whole tree — `tsx watch` and Vite each fork
 * further children.
 */
function spawnChild(
  role: AgentStackRole,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  conversationId: string,
  cwdAppDir: string,
): { child: ChildProcess; record: AgentStackProcess } {
  const fd = openSync(logPath(conversationId, role), "w");
  let child: ChildProcess;
  try {
    child = spawn(command, args, {
      cwd: cwdAppDir,
      env,
      detached: true,
      stdio: ["ignore", fd, fd],
    });
  } finally {
    closeSync(fd);
  }
  child.unref();
  const pid = child.pid;
  if (pid === undefined) throw new Error(`failed to spawn agent stack ${role}`);
  const info = readProcInfo(pid);
  if (info === null) {
    throw new Error(
      `agent stack ${role} exited immediately:\n${tailLog(logPath(conversationId, role))}`,
    );
  }
  return { child, record: { role, pid, startTime: info.startTime } };
}

async function probe(url: string): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(READY_PROBE_TIMEOUT_MS) });
}

/**
 * Ready means the base URL serves the client *and* proxies `/api` to this
 * stack's own API — the two things every caller of the env contract needs.
 */
async function waitForReady(
  conversationId: string,
  baseUrl: string,
  children: { child: ChildProcess; record: AgentStackProcess }[],
): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastFailure = "no probe attempted";
  while (Date.now() < deadline) {
    const dead = children.find(
      ({ child }) => child.exitCode !== null || child.signalCode !== null,
    );
    if (dead) {
      const { role } = dead.record;
      throw new Error(
        `agent stack ${role} exited while starting:\n${tailLog(logPath(conversationId, role))}`,
      );
    }
    try {
      const client = await probe(baseUrl);
      const api = await probe(`${baseUrl}/api/conversations`);
      if (client.ok && api.ok) return;
      lastFailure = `client ${client.status}, /api/conversations ${api.status}`;
    } catch (err) {
      lastFailure = err instanceof Error ? err.message : String(err);
    }
    await delay(READY_POLL_MS);
  }
  throw new Error(
    `agent stack for ${conversationId} was not ready within ${READY_TIMEOUT_MS}ms (${lastFailure})`,
  );
}

type StoryIssue = Extract<Issue, { kind: "story" }>;

interface ResolvedBoot {
  issueId: string;
  worktree: string;
  runtime: Runtime | undefined;
}

interface StackResources {
  port: number;
  auxPort: number;
  dataDir: string;
}

const BASE_URL_VAR = /\$\{(AGENT_STACK_[A-Z0-9_]+)\}|\$(AGENT_STACK_[A-Z0-9_]+)/g;

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

function expandBaseUrl(template: string, env: Record<string, string>): string {
  return template.replace(BASE_URL_VAR, (_match, braced: string | undefined, bare: string | undefined) => {
    const key = (braced ?? bare)!;
    const value = env[key];
    if (value === undefined) {
      throw new Error(`runtime baseUrl references unset ${key}`);
    }
    return value;
  });
}

function resolveBootTarget(issueId: string): ResolvedBoot {
  const { issues } = readAll();
  const chain = ancestorChain(issueId, issues);
  const target = chain[chain.length - 1]!;
  const project = chain[0];
  if (project?.kind !== "project") {
    throw new Error(`issue "${issueId}" is not under a project`);
  }
  const story = target.kind === "story"
    ? target
    : target.kind === "task"
      ? chain[chain.length - 2]
      : undefined;
  if (story?.kind !== "story") {
    throw new Error(`issue "${issueId}" has no Story`);
  }
  const storyIssue: StoryIssue = story;
  const recorded = storyIssue.worktreePath;
  if (!recorded || !existsSync(recorded) || !statSync(recorded).isDirectory()) {
    throw new Error(`Story "${storyIssue.id}" has no live worktree`);
  }
  const runtime = project.runtime;
  if (runtime !== undefined) {
    const missing = [
      runtime.start ? undefined : "start",
      runtime.baseUrl ? undefined : "baseUrl",
    ].filter((key): key is string => key !== undefined);
    if (missing.length > 0) {
      throw new Error(
        `Project "${project.id}" runtime is missing ${missing.join(" and ")}`,
      );
    }
  }
  return { issueId, worktree: resolve(recorded), runtime };
}

function stackVarEnv(resources: StackResources): Record<string, string> {
  return {
    AGENT_STACK_PORT: String(resources.port),
    AGENT_STACK_AUX_PORT: String(resources.auxPort),
    AGENT_STACK_DATA_DIR: resources.dataDir,
  };
}

function phaseEnv(
  resources: StackResources,
  baseUrl: string | undefined,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...stackVarEnv(resources) };
  if (baseUrl === undefined) delete env.AGENT_STACK_BASE_URL;
  else env.AGENT_STACK_BASE_URL = baseUrl;
  return env;
}

async function allocateStackResources(conversationId: string): Promise<StackResources> {
  mkdirSync(agentStackDir(conversationId), { recursive: true });
  const dataDir = join(agentStackDir(conversationId), "data");
  mkdirSync(dataDir, { recursive: true });
  const [port, auxPort] = await pickFreePortPair();
  return { port, auxPort, dataDir };
}

function discardDataDir(dataDir: string): void {
  rmSync(dataDir, { recursive: true, force: true });
}

function runShell(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs?: number,
): Promise<{ code: number; output: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("sh", ["-c", command], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    const append = (chunk: Buffer | string) => {
      output += chunk.toString();
      if (output.length > 64_000) output = output.slice(-32_000);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    const timer = timeoutMs === undefined
      ? undefined
      : setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      finish(() => reject(err));
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      finish(() => resolvePromise({ code: code ?? 1, output }));
    });
  });
}

async function runShellOrThrow(
  phase: string,
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const { code, output } = await runShell(command, cwd, env);
  if (code !== 0) {
    throw new Error(`agent stack ${phase} failed (exit ${code}):\n${tailText(output)}`);
  }
}

function throwIfExited(
  conversationId: string,
  spawned: { child: ChildProcess; record: AgentStackProcess },
): void {
  if (spawned.child.exitCode === null && spawned.child.signalCode === null) return;
  throw new Error(
    `agent stack ${spawned.record.role} exited while starting:\n${tailLog(logPath(conversationId, spawned.record.role))}`,
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
  conversationId: string,
  port: number,
  spawned: { child: ChildProcess; record: AgentStackProcess },
): Promise<void> {
  const timeoutMs = readyTimeoutMs();
  const deadline = Date.now() + timeoutMs;
  let lastFailure = "no probe attempted";
  while (Date.now() < deadline) {
    throwIfExited(conversationId, spawned);
    if (await tcpAccepts(port)) return;
    lastFailure = `port ${port} refused`;
    await delay(READY_POLL_MS);
  }
  throw new Error(
    `agent stack port ${port} did not accept connections within ${timeoutMs}ms (${lastFailure}):\n${tailLog(logPath(conversationId, spawned.record.role))}`,
  );
}

async function waitForReadiness(
  conversationId: string,
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  spawned: { child: ChildProcess; record: AgentStackProcess },
): Promise<void> {
  const timeoutMs = readyTimeoutMs();
  const deadline = Date.now() + timeoutMs;
  let lastOutput = "";
  let lastCode = "none";
  while (Date.now() < deadline) {
    throwIfExited(conversationId, spawned);
    const remaining = Math.max(1, deadline - Date.now());
    const { code, output } = await runShell(command, cwd, env, remaining);
    lastOutput = output;
    lastCode = String(code);
    if (code === 0) return;
    await delay(READY_POLL_MS);
  }
  throw new Error(
    `agent stack readiness was not ready within ${timeoutMs}ms (exit ${lastCode}):\n${tailText(lastOutput)}`,
  );
}

function freshState(
  conversationId: string,
  boot: ResolvedBoot,
  resources: StackResources,
  baseUrl: string,
  processes: AgentStackProcess[],
): AgentStackState {
  return {
    conversationId,
    issueId: boot.issueId,
    worktree: boot.worktree,
    port: resources.port,
    auxPort: resources.auxPort,
    dataDir: resources.dataDir,
    baseUrl,
    startedAt: new Date().toISOString(),
    processes,
    cursorConversationIds: [],
  };
}

function attachCursor(
  state: AgentStackState,
  cursorConversationId: string | undefined,
): AgentStackState {
  if (cursorConversationId === undefined) return state;
  return rememberCursorConversationId(state, cursorConversationId);
}

async function bootDeclaredRuntime(
  conversationId: string,
  boot: ResolvedBoot,
  cursorConversationId: string | undefined,
): Promise<AgentStackHandle> {
  const runtime = boot.runtime!;
  const resources = await allocateStackResources(conversationId);
  let baseUrl: string;
  try {
    baseUrl = expandBaseUrl(runtime.baseUrl!, stackVarEnv(resources));
  } catch (err) {
    discardDataDir(resources.dataDir);
    throw err;
  }
  let stateWritten = false;
  let spawned: ReturnType<typeof spawnChild> | undefined;
  try {
    if (runtime.build) {
      await runShellOrThrow("build", runtime.build, boot.worktree, phaseEnv(resources, undefined));
    }
    spawned = spawnChild(
      "start",
      "sh",
      ["-c", runtime.start!],
      phaseEnv(resources, undefined),
      conversationId,
      boot.worktree,
    );
    let state = freshState(conversationId, boot, resources, baseUrl, [spawned.record]);
    writeAgentStackState(state);
    stateWritten = true;
    state = attachCursor(state, cursorConversationId);
    await waitForPort(conversationId, resources.port, spawned);
    if (runtime.seed) {
      await runShellOrThrow("seed", runtime.seed, boot.worktree, phaseEnv(resources, baseUrl));
    }
    if (runtime.readiness) {
      await waitForReadiness(
        conversationId,
        runtime.readiness,
        boot.worktree,
        phaseEnv(resources, baseUrl),
        spawned,
      );
    }
    return { state, env: agentStackEnv(state), reused: false };
  } catch (err) {
    if (stateWritten) await stopAgentStack(conversationId);
    else {
      if (spawned) signalGroup(spawned.record.pid, "SIGTERM");
      discardDataDir(resources.dataDir);
    }
    throw err;
  }
}

/**
 * Tracker `app/` boot used when the Project has no `runtime` field.
 * `declare-tracker-runtime` removes this path.
 */
async function bootTrackerApp(
  conversationId: string,
  boot: ResolvedBoot,
  cursorConversationId: string | undefined,
): Promise<AgentStackHandle> {
  const asrModelDir = hostAsrModelDir();
  const cwdAppDir = await ensureWorkspaceAppReady(boot.worktree, asrModelDir);
  const vite = binPath("vite", cwdAppDir);
  const tsx = binPath("tsx", cwdAppDir);
  const resources = await allocateStackResources(conversationId);
  const baseUrl = `http://127.0.0.1:${resources.port}`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ISSUES_DIR: issuesDir,
    ISSUE_TRACKER_STORE_READ_ONLY: "1",
    ISSUE_TRACKER_ASR_MODEL_DIR: asrModelDir,
    PORT: String(resources.auxPort),
    VITE_DEV_PORT: String(resources.port),
    VITE_API_PROXY_TARGET: `http://127.0.0.1:${resources.auxPort}`,
  };
  const spawned: ReturnType<typeof spawnChild>[] = [];
  let stateWritten = false;
  try {
    spawned.push(spawnChild("api", tsx, ["watch", "server/index.ts"], env, conversationId, cwdAppDir));
    spawned.push(spawnChild("vite", vite, [], env, conversationId, cwdAppDir));
    let state = freshState(
      conversationId,
      boot,
      resources,
      baseUrl,
      spawned.map(({ record }) => record),
    );
    writeAgentStackState(state);
    stateWritten = true;
    state = attachCursor(state, cursorConversationId);
    await waitForReady(conversationId, baseUrl, spawned);
    return { state, env: agentStackEnv(state), reused: false };
  } catch (err) {
    if (stateWritten) await stopAgentStack(conversationId);
    else {
      for (const { record } of spawned) signalGroup(record.pid, "SIGTERM");
      discardDataDir(resources.dataDir);
    }
    throw err;
  }
}

/**
 * Start (or adopt) this conversation's stack and return the env contract.
 * A recorded stack whose processes are gone — a crash, or a machine restart —
 * is torn down first, so its state never squats the conversation.
 *
 * When `cursorConversationId` is set, also writes the kill-guard disk index
 * entry for that Cursor session after `state.json`.
 */
export async function startAgentStack(
  conversationId: string,
  options: AgentStackStartOptions,
): Promise<AgentStackHandle> {
  ensureChildReaper();
  assertConversationId(conversationId);
  const issueId = options.issueId.trim();
  if (!issueId) throw new Error("agent stack issueId is required");
  const { cursorConversationId } = options;
  if (cursorConversationId !== undefined) {
    assertCursorConversationId(cursorConversationId);
  }
  const boot = resolveBootTarget(issueId);

  const existing = readAgentStackState(conversationId);
  if (existing) {
    if (isStackLive(existing) && existing.worktree === boot.worktree) {
      const state = cursorConversationId === undefined
        ? existing
        : rememberCursorConversationId(existing, cursorConversationId);
      return { state, env: agentStackEnv(state), reused: true };
    }
    await stopAgentStack(conversationId);
  }

  if (boot.runtime) return bootDeclaredRuntime(conversationId, boot, cursorConversationId);
  return bootTrackerApp(conversationId, boot, cursorConversationId);
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (err) {
    // Racing the process's own exit is expected; anything else is not.
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

function releaseAgentStackRecord(state: AgentStackState): void {
  clearCursorIndexes(state);
  rmSync(agentStackStatePath(state.conversationId), { force: true });
}

/**
 * Drop recorded stacks this process does not own. Does not signal them.
 * Returns the conversation ids removed.
 */
export function dropUnownedAgentStackRecords(): string[] {
  if (!existsSync(conversationsDir)) return [];
  const dropped: string[] = [];
  for (const entry of readdirSync(conversationsDir)) {
    if (!isSlugSafe(entry)) continue;
    const dir = join(conversationsDir, entry);
    if (!statSync(dir).isDirectory()) continue;
    const state = readAgentStackState(entry);
    if (!state) continue;
    if (state.processes.some(isOurRecordedProcess)) continue;
    releaseAgentStackRecord(state);
    dropped.push(entry);
  }
  return dropped;
}

/**
 * Stop this conversation's stack and release its ports and ownership. A
 * conversation with no recorded stack is not an error — teardown paths call
 * this unconditionally.
 *
 * A recorded pid that is not this process's child is removed with no signal.
 * Owned live groups get SIGTERM, then SIGKILL after `TERM_GRACE_MS`. The
 * promise settles only after `waitpid` collects the group. Past
 * `KILL_GRACE_MS` it keeps waiting, then rejects.
 */
export async function stopAgentStack(
  conversationId: string,
): Promise<AgentStackStopResult> {
  ensureChildReaper();
  const state = readAgentStackState(conversationId);
  if (!state) return { stopped: false, state: null };

  const owned = state.processes.filter(isOurRecordedProcess);
  const live = owned.filter(isProcessLive);
  const groups = new Set<number>();
  for (const proc of owned) {
    const info = readProcInfo(proc.pid);
    if (info) groups.add(info.pgrp);
  }

  if (live.length > 0) {
    for (const proc of live) signalGroup(proc.pid, "SIGTERM");
    const collectedOnTerm = await waitUntilGroupsCollected(groups, TERM_GRACE_MS);
    if (!collectedOnTerm) {
      for (const pgrp of groups) signalGroup(pgrp, "SIGKILL");
      const collectedOnKill = await waitUntilGroupsCollected(groups, KILL_GRACE_MS);
      if (!collectedOnKill) {
        const survivors = owned.filter(isOurRecordedProcess);
        await waitUntilGroupsCollected(groups, Number.POSITIVE_INFINITY);
        releaseStoppedStack(state);
        throw new Error(
          `agent stack for ${conversationId} survived SIGKILL: ${
            survivors.map((proc) => `${proc.role}(${proc.pid})`).join(", ") ||
            "group still uncollected"
          }`,
        );
      }
    }
  } else if (groups.size > 0) {
    await waitUntilGroupsCollected(groups, Number.POSITIVE_INFINITY);
  }

  releaseStoppedStack(state);
  return { stopped: true, state };
}

function releaseStoppedStack(state: AgentStackState): void {
  rmSync(state.dataDir, { recursive: true, force: true });
  releaseAgentStackRecord(state);
}
