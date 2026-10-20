import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { conversationsDir } from "../config.js";
import { KIND_LABEL } from "../kind.js";
import type { Runtime } from "../schemas.js";
import { isSlugSafe } from "../slug.js";
import { collectAgentStackMemoryLimitFailures } from "./agent-stack-heap-reports.js";
import { loadPhaseSecrets } from "./agent-stack-secrets.js";

export { agentStackMemoryLimitMessage } from "./agent-stack-heap-reports.js";
import { killProcessGroup } from "./bounded-process.js";
import { ensureChildReaper } from "./child-reaper.js";
import { readAll } from "./issues.js";
import {
  allocateRuntimeResources,
  bootRuntime,
  discardRuntimeDataDir,
  expandRuntimeBaseUrl,
  isOurRecordedProcess,
  missingDeclaredRuntimeFields,
  phaseEnv,
  RuntimeBootCancelled,
  runtimeBootPhaseReportSchema,
  runtimeProcessesLive,
  runtimeVarEnv,
  runRuntimeShell,
  runtimeProcessSchema,
  stopRuntimeProcesses,
  tailRuntimeOutput,
  type RuntimeProcess,
  type RuntimeResources,
} from "./runtime-boot.js";
import { settledValues } from "./settled-values.js";
import { ancestorChain, nearestWorktreeIssue } from "./subtree.js";

/**
 * One conversation's verification stack, on ports picked free at start time.
 * The Project runtime declaration owns how that stack is built and started.
 * Agents verify here instead of on the human's stack. A review issue boots
 * from that review's worktree; the stack record stays under this conversation.
 */

export const agentStackProcessSchema = runtimeProcessSchema;

export const agentStackStateSchema = z.object({
  conversationId: z.string().min(1),
  /** Issue the stack was asked to boot. */
  issueId: z.string().min(1),
  /** Absolute worktree this stack booted. */
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
  /** Latest phase report while a boot is in flight. Absent once the stack is running. */
  bootPhase: runtimeBootPhaseReportSchema.optional(),
});

export type AgentStackRole = RuntimeProcess["role"];
export type AgentStackProcess = RuntimeProcess;
export type AgentStackState = z.infer<typeof agentStackStateSchema>;

export interface AgentStackStartOptions {
  /**
   * Issue whose nearest worktree-capable ancestor (itself, when it has the
   * capability) supplies the live worktree to boot. A review is that issue
   * when it has a live checkout.
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
  /** Heap-limit death lines from this stack's reports, in report order. */
  memoryLimitFailures: string[];
}

/** `stopped: false` means no stack was recorded for the conversation. */
export type AgentStackStopResult =
  | { stopped: true; state: AgentStackState; memoryLimitFailures: string[] }
  | { stopped: false; state: null; memoryLimitFailures: string[] };

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
  // Browser tools derive their origin allowlist from this file on each
  // navigation, so writing it is what lets a session browse a stack that
  // starts mid-conversation.
  writeFileSync(
    agentStackStatePath(state.conversationId),
    `${JSON.stringify(state, null, 2)}\n`,
  );
}

/** True when every recorded process of the stack is still live. */
export function isStackLive(state: AgentStackState): boolean {
  return runtimeProcessesLive(state.processes);
}

interface ResolvedBoot {
  issueId: string;
  projectId: string;
  worktree: string;
  runtime: Runtime;
}

function resolveBootTarget(issueId: string): ResolvedBoot {
  const { issues } = readAll();
  const chain = ancestorChain(issueId, issues);
  const project = chain[0];
  if (project?.kind !== "project") {
    throw new Error(`issue "${issueId}" is not under a project`);
  }
  const worktreeIssue = nearestWorktreeIssue(chain);
  if (!worktreeIssue) {
    throw new Error(`issue "${issueId}" has no worktree`);
  }
  const recorded = worktreeIssue.worktreePath;
  if (!recorded || !existsSync(recorded) || !statSync(recorded).isDirectory()) {
    throw new Error(
      `${KIND_LABEL[worktreeIssue.kind]} "${worktreeIssue.id}" has no live worktree`,
    );
  }
  const runtime = project.runtime;
  const missing = missingDeclaredRuntimeFields(runtime);
  if (!runtime || missing.length > 0) {
    throw new Error(
      `Project "${project.id}" runtime is missing ${missing.join(" and ")}`,
    );
  }
  return { issueId, projectId: project.id, worktree: resolve(recorded), runtime };
}

/** One redeploy or readiness command: stack phase env, exit status, output tail. */
export async function runAgentStackShell(
  command: string,
  cwd: string,
  state: Pick<AgentStackState, "port" | "auxPort" | "dataDir" | "baseUrl">,
  secrets: Record<string, string>,
): Promise<{ exitStatus: number; output: string }> {
  const env = phaseEnv(
    { port: state.port, auxPort: state.auxPort, dataDir: state.dataDir },
    state.baseUrl,
    secrets,
  );
  const { code, output } = await runRuntimeShell(command, cwd, env, secrets);
  return { exitStatus: code, output: tailRuntimeOutput(output) };
}

function freshState(
  conversationId: string,
  boot: ResolvedBoot,
  resources: RuntimeResources,
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

interface LiveAgentStackBoot {
  controller: AbortController;
  /** Resolves once this boot attempt has finished, including a cancelled one. */
  settled: Promise<void>;
}

const liveBoots = new Map<string, LiveAgentStackBoot>();

/** Conversation ids whose boot has not settled. Snapshot; later starts are absent. */
function inFlightAgentStackBootIds(): string[] {
  return [...liveBoots.keys()];
}

async function settleLiveAgentStackBoot(conversationId: string): Promise<void> {
  const live = liveBoots.get(conversationId);
  if (!live) return;
  live.controller.abort();
  await live.settled;
}

async function bootDeclaredRuntime(
  conversationId: string,
  boot: ResolvedBoot,
  cursorConversationId: string | undefined,
  secrets: Record<string, string>,
): Promise<AgentStackHandle> {
  const resources = await allocateRuntimeResources(agentStackDir(conversationId));
  const controller = new AbortController();
  const done = runAgentStackBoot(
    conversationId,
    boot,
    resources,
    cursorConversationId,
    secrets,
    controller.signal,
  );
  const live: LiveAgentStackBoot = {
    controller,
    settled: done.then(
      () => undefined,
      () => undefined,
    ),
  };
  liveBoots.set(conversationId, live);
  try {
    return await done;
  } finally {
    if (liveBoots.get(conversationId) === live) liveBoots.delete(conversationId);
  }
}

async function runAgentStackBoot(
  conversationId: string,
  boot: ResolvedBoot,
  resources: RuntimeResources,
  cursorConversationId: string | undefined,
  secrets: Record<string, string>,
  signal: AbortSignal,
): Promise<AgentStackHandle> {
  let stateWritten = false;
  let phasePid: number | undefined;
  let started: RuntimeProcess | undefined;
  let recorded: AgentStackState | undefined;
  let bootBaseUrl: string | undefined;
  try {
    const booted = await bootRuntime({
      logDir: agentStackDir(conversationId),
      resources,
      worktree: boot.worktree,
      runtime: boot.runtime,
      secrets,
      signal,
      onPhase: (report) => {
        phasePid = report.process.pid;
        if (report.phase === "start") {
          started = { role: "start", ...report.process };
        }
        // `bootRuntime` rejects a missing baseUrl before the first phase.
        const baseUrl =
          bootBaseUrl ??
          expandRuntimeBaseUrl(boot.runtime.baseUrl!, runtimeVarEnv(resources));
        bootBaseUrl = baseUrl;
        const next: AgentStackState = {
          ...(recorded ?? freshState(conversationId, boot, resources, baseUrl, [])),
          processes: started ? [started] : [],
          bootPhase: report,
        };
        writeAgentStackState(next);
        stateWritten = true;
        recorded = attachCursor(next, cursorConversationId);
      },
    });
    if (!recorded) {
      throw new Error(`agent stack for ${conversationId} lost its state`);
    }
    const { bootPhase: _bootPhase, ...rest } = recorded;
    const running: AgentStackState = {
      ...rest,
      baseUrl: booted.baseUrl,
      processes: [booted.process],
    };
    writeAgentStackState(running);
    return {
      state: running,
      env: agentStackEnv(running),
      reused: false,
      memoryLimitFailures: [],
    };
  } catch (err) {
    if (err instanceof RuntimeBootCancelled) {
      // The stop that aborted this boot releases the record after `settled`.
      if (!stateWritten) releaseUnrecordedBoot(resources.dataDir, phasePid);
      throw err;
    }
    // `stopAgentStack` waits on `settled`, which resolves only after this
    // cleanup returns, so a failed boot releases its own record.
    await releaseFailedBoot(conversationId, resources.dataDir, stateWritten, phasePid);
    throw err;
  }
}

function releaseUnrecordedBoot(dataDir: string, phasePid: number | undefined): void {
  if (phasePid !== undefined) killProcessGroup(phasePid, "SIGTERM");
  discardRuntimeDataDir(dataDir);
}

async function releaseFailedBoot(
  conversationId: string,
  dataDir: string,
  stateWritten: boolean,
  phasePid: number | undefined,
): Promise<void> {
  if (!stateWritten) {
    releaseUnrecordedBoot(dataDir, phasePid);
    return;
  }
  const state = readAgentStackState(conversationId);
  if (!state) {
    throw new Error(`agent stack for ${conversationId} lost its state`);
  }
  await stopRecordedStack(state);
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
  const secrets = loadPhaseSecrets(boot.projectId);

  const existing = readAgentStackState(conversationId);
  let memoryLimitFailures: string[] = [];
  if (existing) {
    if (isStackLive(existing) && existing.worktree === boot.worktree) {
      const state = cursorConversationId === undefined
        ? existing
        : rememberCursorConversationId(existing, cursorConversationId);
      return {
        state,
        env: agentStackEnv(state),
        reused: true,
        memoryLimitFailures: [],
      };
    }
    memoryLimitFailures = collectAgentStackMemoryLimitFailures(existing.dataDir);
    await stopAgentStack(conversationId);
  }

  await syncReviewsOnWorktree(boot.worktree);
  const handle = await bootDeclaredRuntime(
    conversationId,
    boot,
    cursorConversationId,
    secrets,
  );
  return { ...handle, memoryLimitFailures };
}

function releaseAgentStackRecord(state: AgentStackState): void {
  // Removing the record is what refuses later browser navigations.
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
 * Abort a boot still in flight and release its record. A stack that has
 * finished booting stays up, so conversation teardown can cancel the turn
 * before stopping it.
 */
export async function cancelBootingAgentStack(
  conversationId: string,
): Promise<AgentStackStopResult | undefined> {
  if (!liveBoots.has(conversationId)) return undefined;
  await settleLiveAgentStackBoot(conversationId);
  // Success drops `bootPhase` before the live boot is cleared. A running
  // stack stays up. A cancelled boot keeps the phase report for Stop.
  const state = readAgentStackState(conversationId);
  if (!state?.bootPhase) return undefined;
  return stopRecordedStack(state);
}

/**
 * API shutdown. Cancels agent-stack boots still in flight, through the same
 * path as Stop, and settles once each of those records and data directories
 * is gone. A stack that has finished booting stays up.
 */
export function cancelInFlightAgentStackBootsOnShutdown(): Promise<AgentStackStopResult[]> {
  return settledValues(inFlightAgentStackBootIds().map((id) => cancelBootingAgentStack(id)));
}

/**
 * Stop this conversation's stack and release its ports and ownership. A
 * conversation with no recorded stack is not an error — teardown paths call
 * this unconditionally.
 *
 * An in-flight boot is aborted and its phase group is collected before the
 * record and data directory are released. A recorded pid that is not this
 * process's child is removed with no signal. Owned live groups get SIGTERM,
 * then SIGKILL after the term grace. The promise settles only after `waitpid`
 * collects those groups.
 */
export async function stopAgentStack(
  conversationId: string,
): Promise<AgentStackStopResult> {
  ensureChildReaper();
  await settleLiveAgentStackBoot(conversationId);
  const state = readAgentStackState(conversationId);
  if (!state) return { stopped: false, state: null, memoryLimitFailures: [] };
  return stopRecordedStack(state);
}

async function stopRecordedStack(state: AgentStackState): Promise<AgentStackStopResult> {
  const memoryLimitFailures = collectAgentStackMemoryLimitFailures(state.dataDir);
  try {
    await stopRuntimeProcesses(state.processes, `agent stack for ${state.conversationId}`);
  } catch (err) {
    await releaseStoppedStackAndSync(state);
    throw err;
  }
  await releaseStoppedStackAndSync(state);
  return { stopped: true, state, memoryLimitFailures };
}

function releaseStoppedStack(state: AgentStackState): void {
  rmSync(state.dataDir, { recursive: true, force: true });
  releaseAgentStackRecord(state);
}

/**
 * The stack record is already gone. A checkout failure must not report the
 * stop as failed; the next sync retries it.
 */
async function releaseStoppedStackAndSync(state: AgentStackState): Promise<void> {
  releaseStoppedStack(state);
  try {
    await syncReviewsOnWorktree(state.worktree);
  } catch (err) {
    console.error(`review worktree sync failed for ${state.worktree}:`, err);
  }
}

async function syncReviewsOnWorktree(worktree: string): Promise<void> {
  const { syncReviewsAtWorktree } = await import("./review-worktree-sync.js");
  await syncReviewsAtWorktree(worktree);
}
