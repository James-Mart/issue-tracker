// Plain JavaScript (not TypeScript): the hook is spawned by `node` directly for
// every shell tool call, and routing it through `tsx` would add hundreds of
// milliseconds to every command any agent or human runs on this machine.

import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DENY_MESSAGE =
  "Refusing to kill a port this conversation does not currently own. Call agent_stack_start and verify on your own stack instead of killing another process's listen ports.";

/**
 * Resolve conversationsDir the same way as `app/server/config.ts`: peer of
 * issuesDir, with ISSUES_DIR overriding the default plugin issues path.
 * @param {string} [hookDir]
 * @returns {string}
 */
export function resolveConversationsDir(hookDir = dirname(fileURLToPath(import.meta.url))) {
  const pluginDir = resolve(hookDir, "../..");
  const issuesDir = process.env.ISSUES_DIR ?? join(pluginDir, "issues");
  return join(dirname(issuesDir), "conversations");
}

/**
 * Prefer the live preToolUse field (`tool_input.command`); also accept
 * `input.command` so older/alternate shapes keep working.
 * @param {unknown} payload
 * @returns {string | undefined}
 */
export function commandFromPayload(payload) {
  if (payload == null || typeof payload !== "object") return undefined;
  const record = /** @type {Record<string, unknown>} */ (payload);
  for (const key of ["tool_input", "input"]) {
    const nested = record[key];
    if (nested != null && typeof nested === "object") {
      const command = /** @type {Record<string, unknown>} */ (nested).command;
      if (typeof command === "string") return command;
    }
  }
  return undefined;
}

/**
 * @param {unknown} payload
 * @returns {string | undefined}
 */
export function conversationIdFromPayload(payload) {
  if (payload == null || typeof payload !== "object") return undefined;
  const id = /** @type {Record<string, unknown>} */ (payload).conversation_id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

/** `/proc/<pid>/stat` state char and start time, or null when the pid is gone. */
function readProcInfo(pid) {
  let stat;
  try {
    stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch {
    return null;
  }
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  const state = fields[0];
  const startTime = fields[19];
  if (!state || !startTime) return null;
  return { state, startTime };
}

/**
 * True when the recorded pid is still the process we spawned, and not a zombie.
 * @param {{ pid: number, startTime: string }} proc
 */
export function isProcessLive(proc) {
  const info = readProcInfo(proc.pid);
  return (
    info !== null && info.state !== "Z" && info.startTime === proc.startTime
  );
}

/**
 * Listening TCP ports for a pid, from /proc only (no Shell / lsof spawn).
 * @param {number} pid
 * @returns {number[]}
 */
export function listeningPortsForPid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return [];
  const inodes = new Set();
  try {
    const fdDir = `/proc/${pid}/fd`;
    for (const name of readdirSync(fdDir)) {
      try {
        const target = readlinkSync(join(fdDir, name));
        const match = /^socket:\[(\d+)\]$/.exec(target);
        if (match) inodes.add(match[1]);
      } catch {
        // fd raced away
      }
    }
  } catch {
    return [];
  }
  if (inodes.size === 0) return [];

  const ports = new Set();
  for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let content;
    try {
      content = readFileSync(table, "utf8");
    } catch {
      continue;
    }
    for (const line of content.split("\n").slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 10) continue;
      // 0A = LISTEN
      if (parts[3] !== "0A") continue;
      if (!inodes.has(parts[9])) continue;
      const portHex = parts[1]?.split(":")[1];
      if (!portHex) continue;
      ports.add(parseInt(portHex, 16));
    }
  }
  return [...ports];
}

/**
 * Split on command separators but keep pipelines (`a | b`) together so
 * `lsof … | xargs kill` stays one unit.
 * @param {string} command
 * @returns {string[]}
 */
function shellSegments(command) {
  return command.split(/(?:&&|\|\||;|\n)+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * @param {string} segment
 * @returns {number[] | null} ports when this segment is `fuser -k …`; null otherwise
 */
function fuserKillPorts(segment) {
  if (!/\bfuser\b/.test(segment)) return null;
  // Flag tokens that include `k` (`-k`, `-vk`, `-km`, …) mark a kill.
  const tokens = segment.match(/(?:[^\s|&;]+)/g) ?? [];
  const fuserIndex = tokens.findIndex((t) => t === "fuser" || t.endsWith("/fuser"));
  if (fuserIndex === -1) return null;
  const after = tokens.slice(fuserIndex + 1);
  const hasK = after.some((t) => t.startsWith("-") && !t.startsWith("--") && t.includes("k"));
  if (!hasK) return null;
  const ports = [];
  for (const token of after) {
    if (token.startsWith("-")) continue;
    const match = /^(\d+)(?:\/(?:tcp|udp))?$/i.exec(token);
    if (match) ports.push(Number(match[1]));
  }
  return ports;
}

/**
 * @param {string} command
 * @returns {number[] | null}
 */
function lsofPipelineKillPorts(command) {
  if (!/\blsof\b/.test(command) || !/\bkill\b/.test(command)) return null;
  const ports = [];
  const re = /(?:-i(?:TCP|UDP)?\s*:?\s*|:)(\d+)\b/gi;
  let match;
  while ((match = re.exec(command)) !== null) {
    ports.push(Number(match[1]));
  }
  return ports;
}

/**
 * @param {string} command
 * @returns {number[] | null} listening ports of kill targets, or null when not a bare kill
 */
function bareKillListeningPorts(command) {
  // kill [-signal ...] pid [pid...] — signals always start with `-`.
  const match =
    /(?:^|[\s;|&])kill(?:\s+-(?:[0-9]+|[A-Z]+|SIG[A-Z]+))*\s+(\d+(?:\s+\d+)*)/.exec(
      ` ${command} `,
    );
  if (!match) return null;
  const pids = match[1]
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  if (pids.length === 0) return null;
  const ports = [];
  for (const pid of pids) {
    ports.push(...listeningPortsForPid(pid));
  }
  return ports.length > 0 ? ports : null;
}

/**
 * Classify whether a shell command is kill-shaped port targeting.
 * @param {string} command
 * @returns {{ kind: 'not-kill' } | { kind: 'port-kill', ports: number[] }}
 */
export function classifyPortKill(command) {
  const ports = new Set();
  let matched = false;

  for (const segment of shellSegments(command)) {
    const fuserPorts = fuserKillPorts(segment);
    if (fuserPorts !== null) {
      matched = true;
      for (const port of fuserPorts) ports.add(port);
    }
  }

  const lsofPorts = lsofPipelineKillPorts(command);
  if (lsofPorts !== null) {
    matched = true;
    for (const port of lsofPorts) ports.add(port);
  }

  // Bare `kill <pid>` only counts when those pids currently listen on ports.
  // Skip when the command already paired lsof with kill — ports come from lsof.
  if (lsofPorts === null) {
    const killPorts = bareKillListeningPorts(command);
    if (killPorts !== null) {
      matched = true;
      for (const port of killPorts) ports.add(port);
    }
  }

  if (!matched) return { kind: "not-kill" };
  return { kind: "port-kill", ports: [...ports] };
}

/**
 * Ports this Cursor conversation currently owns (allowlisted + live process).
 * Missing/unreadable index or state → empty set (fail closed for kills).
 * @param {string | undefined} cursorConversationId
 * @param {string} conversationsDir
 * @returns {Set<number>}
 */
export function loadOwnedPorts(cursorConversationId, conversationsDir) {
  const owned = new Set();
  if (
    typeof cursorConversationId !== "string" ||
    cursorConversationId.length === 0
  ) {
    return owned;
  }

  let appConversationId;
  try {
    const indexRaw = readFileSync(
      join(
        conversationsDir,
        "agent-stack-cursor-index",
        `${cursorConversationId}.json`,
      ),
      "utf8",
    );
    const index = JSON.parse(indexRaw);
    if (
      index == null ||
      typeof index !== "object" ||
      typeof index.appConversationId !== "string" ||
      index.appConversationId.length === 0
    ) {
      return owned;
    }
    appConversationId = index.appConversationId;
  } catch {
    return owned;
  }

  let state;
  try {
    const stateRaw = readFileSync(
      join(conversationsDir, appConversationId, "agent-stack", "state.json"),
      "utf8",
    );
    state = JSON.parse(stateRaw);
  } catch {
    return owned;
  }

  if (state == null || typeof state !== "object") return owned;
  const processes = Array.isArray(state.processes) ? state.processes : [];
  for (const proc of processes) {
    if (proc == null || typeof proc !== "object") continue;
    if (typeof proc.pid !== "number" || typeof proc.startTime !== "string") {
      continue;
    }
    if (!isProcessLive(proc)) continue;
    if (proc.role === "api" && Number.isInteger(state.apiPort)) {
      owned.add(state.apiPort);
    }
    if (proc.role === "vite" && Number.isInteger(state.vitePort)) {
      owned.add(state.vitePort);
    }
  }
  return owned;
}

/**
 * @param {{
 *   command: string,
 *   conversationId: string | undefined,
 *   conversationsDir: string,
 * }} args
 * @returns {{ permission: 'allow' } | { permission: 'deny', agent_message: string }}
 */
export function decidePortKillPermission({
  command,
  conversationId,
  conversationsDir,
}) {
  const classification = classifyPortKill(command);
  if (classification.kind === "not-kill") {
    return { permission: "allow" };
  }

  const owned = loadOwnedPorts(conversationId, conversationsDir);
  const { ports } = classification;
  // Empty ports (e.g. `fuser -k` with no parseable target) → fail closed.
  if (ports.length === 0 || !ports.every((port) => owned.has(port))) {
    return { permission: "deny", agent_message: DENY_MESSAGE };
  }
  return { permission: "allow" };
}

function printResult(result) {
  process.stdout.write(JSON.stringify(result));
}

function runAsHook() {
  try {
    const payload = JSON.parse(readFileSync(0, "utf8"));
    const command = commandFromPayload(payload);
    if (typeof command !== "string") {
      printResult({ permission: "allow" });
      return;
    }
    printResult(
      decidePortKillPermission({
        command,
        conversationId: conversationIdFromPayload(payload),
        conversationsDir: resolveConversationsDir(),
      }),
    );
  } catch {
    // Malformed hook stdin: do not block unrelated Shell use.
    printResult({ permission: "allow" });
  }
}

const isMain =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  runAsHook();
}
