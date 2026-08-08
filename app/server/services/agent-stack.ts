import { spawn, type ChildProcess } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type AddressInfo, type Server } from "node:net";
import { join } from "node:path";
import { z } from "zod";
import { appDir, conversationsDir } from "../config.js";
import { isSlugSafe } from "../slug.js";

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
  role: z.enum(["api", "vite"]),
  pid: z.number().int().positive(),
  /**
   * `/proc/<pid>/stat` start time. Pins the pid to the process we spawned, so a
   * recycled pid in state left behind by a crash does not read as owned.
   */
  startTime: z.string().min(1),
});

const agentStackStateSchema = z.object({
  conversationId: z.string().min(1),
  apiPort: z.number().int().positive(),
  vitePort: z.number().int().positive(),
  baseUrl: z.string().min(1),
  startedAt: z.string().min(1),
  processes: z.array(agentStackProcessSchema),
});

export type AgentStackRole = z.infer<typeof agentStackProcessSchema>["role"];
export type AgentStackProcess = z.infer<typeof agentStackProcessSchema>;
export type AgentStackState = z.infer<typeof agentStackStateSchema>;

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

/** Peer of the conversation's `agent-state/`. */
export function agentStackDir(conversationId: string): string {
  assertConversationId(conversationId);
  return join(conversationsDir, conversationId, "agent-stack");
}

export function agentStackStatePath(conversationId: string): string {
  return join(agentStackDir(conversationId), "state.json");
}

function logPath(conversationId: string, role: AgentStackRole): string {
  return join(agentStackDir(conversationId), `${role}.log`);
}

export function agentStackEnv(state: AgentStackState): Record<string, string> {
  return {
    AGENT_STACK_API_PORT: String(state.apiPort),
    AGENT_STACK_VITE_PORT: String(state.vitePort),
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

/** `/proc/<pid>/stat` state char and start time, or null when the pid is gone. */
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
export function isProcessLive(proc: AgentStackProcess): boolean {
  const info = readProcInfo(proc.pid);
  return info !== null && info.state !== "Z" && info.startTime === proc.startTime;
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

function binPath(name: string): string {
  const bin = join(appDir, "node_modules", ".bin", name);
  if (!existsSync(bin)) {
    throw new Error(`missing ${bin} — run \`npm install\` from \`app/\``);
  }
  return bin;
}

function tailLog(path: string, maxLines = 20): string {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8").trimEnd().split("\n").slice(-maxLines).join("\n");
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
): { child: ChildProcess; record: AgentStackProcess } {
  const fd = openSync(logPath(conversationId, role), "w");
  let child: ChildProcess;
  try {
    child = spawn(command, args, {
      cwd: appDir,
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

/**
 * Start (or adopt) this conversation's stack and return the env contract.
 * A recorded stack whose processes are gone — a crash, or a machine restart —
 * is torn down first, so its state never squats the conversation.
 */
export async function startAgentStack(
  conversationId: string,
): Promise<AgentStackHandle> {
  assertConversationId(conversationId);

  const existing = readAgentStackState(conversationId);
  if (existing) {
    if (isStackLive(existing)) {
      return { state: existing, env: agentStackEnv(existing), reused: true };
    }
    await stopAgentStack(conversationId);
  }

  const vite = binPath("vite");
  const tsx = binPath("tsx");
  mkdirSync(agentStackDir(conversationId), { recursive: true });

  const [apiPort, vitePort] = await pickFreePortPair();
  const baseUrl = `http://127.0.0.1:${vitePort}`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(apiPort),
    VITE_DEV_PORT: String(vitePort),
    VITE_API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
  };

  const spawned: ReturnType<typeof spawnChild>[] = [];
  try {
    spawned.push(
      spawnChild("api", tsx, ["watch", "server/index.ts"], env, conversationId),
    );
    spawned.push(spawnChild("vite", vite, [], env, conversationId));
  } catch (err) {
    // No state file yet, so nothing else can reclaim these ports for us.
    for (const { record } of spawned) signalGroup(record.pid, "SIGTERM");
    throw err;
  }

  const state: AgentStackState = {
    conversationId,
    apiPort,
    vitePort,
    baseUrl,
    startedAt: new Date().toISOString(),
    processes: spawned.map(({ record }) => record),
  };
  writeAgentStackState(state);

  try {
    await waitForReady(conversationId, baseUrl, spawned);
  } catch (err) {
    await stopAgentStack(conversationId);
    throw err;
  }

  return { state, env: agentStackEnv(state), reused: false };
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (err) {
    // Racing the process's own exit is expected; anything else is not.
    if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
  }
}

async function waitForExit(
  procs: AgentStackProcess[],
  timeoutMs: number,
): Promise<AgentStackProcess[]> {
  const deadline = Date.now() + timeoutMs;
  let remaining = procs.filter(isProcessLive);
  while (remaining.length > 0 && Date.now() < deadline) {
    await delay(EXIT_POLL_MS);
    remaining = remaining.filter(isProcessLive);
  }
  return remaining;
}

/**
 * Stop this conversation's stack and release its ports and ownership. A
 * conversation with no recorded stack is not an error — teardown paths call
 * this unconditionally.
 */
export async function stopAgentStack(
  conversationId: string,
): Promise<AgentStackStopResult> {
  const state = readAgentStackState(conversationId);
  if (!state) return { stopped: false, state: null };

  const live = state.processes.filter(isProcessLive);
  for (const proc of live) signalGroup(proc.pid, "SIGTERM");
  const stubborn = await waitForExit(live, TERM_GRACE_MS);
  for (const proc of stubborn) signalGroup(proc.pid, "SIGKILL");
  const survivors = await waitForExit(stubborn, KILL_GRACE_MS);
  if (survivors.length > 0) {
    // Keep the state file: it is the only record of who still holds the ports.
    throw new Error(
      `agent stack for ${conversationId} survived SIGKILL: ${survivors
        .map((proc) => `${proc.role}(${proc.pid})`)
        .join(", ")}`,
    );
  }

  rmSync(agentStackStatePath(conversationId), { force: true });
  return { stopped: true, state };
}
