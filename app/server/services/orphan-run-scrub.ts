import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import { JSONL_LOCAL_AGENT_STORE_FILES } from "@cursor/sdk";
import { conversationsDir } from "../config.js";
import type { TranscriptEvent, TranscriptEventInput } from "../schemas.js";
import { evictConversationStoreCaches } from "./agent-state-caches.js";
import { appendEvent, listConversationIds, readConversation } from "./conversations.js";
import {
  clearRunLiveMarker,
  isRunLive,
  runLiveMarkerExists,
} from "./run-live.js";

const RECONCILE_LOCK = "reconcile.lock";
const STORE_REWRITE_TMP_SUFFIX = `.${process.pid}.scrub-tmp`;

const TERMINAL_RUN_STATUSES = new Set([
  "finished",
  "error",
  "cancelled",
  "expired",
]);

const HOST_PROCESS_DIED_TOOL_MESSAGE =
  "Host process died before this tool finished.";
const HOST_CRASH_RECOVERY_MESSAGE =
  "The previous turn was cut off because the host process died.";

type JsonRecord = Record<string, unknown>;

type StoreSnapshot = {
  agentsPath: string;
  runsPath: string;
  agents: JsonRecord[];
  runs: JsonRecord[];
  agentsDirty: boolean;
  runsDirty: boolean;
};

function conversationDir(conversationId: string): string {
  return join(conversationsDir, conversationId);
}

function agentStateDir(conversationId: string): string {
  return join(conversationDir(conversationId), "agent-state");
}

function lockPath(conversationId: string): string {
  return join(conversationDir(conversationId), RECONCILE_LOCK);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True when `pid` is not a live process (`ESRCH`). */
function isPidDead(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ESRCH";
  }
}

/**
 * Holder pid, or null when the lock is gone or unreadable.
 * A torn lock write is external crash residue: it names no live holder, so
 * the next reconcile takes the lock over.
 */
function readLockHolderPid(path: string): number | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as { pid?: unknown };
    if (
      typeof parsed.pid === "number" &&
      Number.isInteger(parsed.pid) &&
      parsed.pid > 0
    ) {
      return parsed.pid;
    }
  } catch {
    return null;
  }
  return null;
}

async function acquireConversationLock(conversationId: string): Promise<void> {
  const path = lockPath(conversationId);
  const payload = `${JSON.stringify({ pid: process.pid })}\n`;
  for (;;) {
    try {
      writeFileSync(path, payload, { flag: "wx" });
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const holder = readLockHolderPid(path);
      if (holder !== null && !isPidDead(holder)) {
        await delay(25);
        continue;
      }
      rmSync(path, { force: true });
    }
  }
}

function releaseConversationLock(conversationId: string): void {
  const path = lockPath(conversationId);
  if (readLockHolderPid(path) !== process.pid) return;
  rmSync(path, { force: true });
}

function storeReadError(filePath: string, err: unknown): Error {
  return new Error(`unreadable SDK store at ${filePath}: ${errorMessage(err)}`);
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNdjson(filePath: string): JsonRecord[] {
  if (!statExists(filePath)) return [];
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (err) {
    throw storeReadError(filePath, err);
  }
  const records: JsonRecord[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      throw storeReadError(filePath, err);
    }
    if (!isJsonRecord(parsed)) {
      throw new Error(
        `unreadable SDK store at ${filePath}: line ${i + 1} is not an object`,
      );
    }
    records.push(parsed);
  }
  return records;
}

function statExists(filePath: string): boolean {
  try {
    statSync(filePath);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

function writeNdjson(filePath: string, records: readonly JsonRecord[]): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const body =
    records.length === 0
      ? ""
      : `${records.map((row) => JSON.stringify(row)).join("\n")}\n`;
  const tmp = `${filePath}${STORE_REWRITE_TMP_SUFFIX}`;
  writeFileSync(tmp, body);
  renameSync(tmp, filePath);
}

function storeDirs(conversationId: string): string[] {
  const root = agentStateDir(conversationId);
  if (!statExists(root)) return [];
  if (!statSync(root).isDirectory()) {
    throw new Error(`unreadable SDK store at ${root}: not a directory`);
  }
  const dirs = [root];
  const nestedRoot = join(root, "nested");
  if (!statExists(nestedRoot)) return dirs;
  let entries;
  try {
    entries = readdirSync(nestedRoot, { withFileTypes: true });
  } catch (err) {
    throw storeReadError(nestedRoot, err);
  }
  for (const ent of entries) {
    if (ent.isDirectory()) dirs.push(join(nestedRoot, ent.name));
  }
  return dirs;
}

function readStores(conversationId: string): StoreSnapshot[] {
  return storeDirs(conversationId).map((dir) => ({
    agentsPath: join(dir, JSONL_LOCAL_AGENT_STORE_FILES.agents),
    runsPath: join(dir, JSONL_LOCAL_AGENT_STORE_FILES.runs),
    agents: readNdjson(join(dir, JSONL_LOCAL_AGENT_STORE_FILES.agents)),
    runs: readNdjson(join(dir, JSONL_LOCAL_AGENT_STORE_FILES.runs)),
    agentsDirty: false,
    runsDirty: false,
  }));
}

function closeNonTerminalRuns(runs: JsonRecord[], endedAt: number): boolean {
  let closed = false;
  for (const row of runs) {
    const status = row.status;
    if (typeof status === "string" && TERMINAL_RUN_STATUSES.has(status)) {
      continue;
    }
    row.status = "error";
    row.error = "host_process_died";
    row.endedAt = endedAt;
    row.updatedAt = endedAt;
    closed = true;
  }
  return closed;
}

function idleAgentRows(agents: JsonRecord[], updatedAt: number): boolean {
  let dirty = false;
  for (const row of agents) {
    if (row.status === "idle" && row.activeRunId === null) continue;
    row.status = "idle";
    row.activeRunId = null;
    row.updatedAt = updatedAt;
    dirty = true;
  }
  return dirty;
}

function scrubStores(stores: StoreSnapshot[], scrubbedAt: number): boolean {
  let closedRun = false;
  for (const store of stores) {
    if (closeNonTerminalRuns(store.runs, scrubbedAt)) {
      store.runsDirty = true;
      closedRun = true;
    }
    if (idleAgentRows(store.agents, scrubbedAt)) {
      store.agentsDirty = true;
    }
  }
  return closedRun;
}

function writeStores(stores: readonly StoreSnapshot[]): void {
  for (const store of stores) {
    if (store.runsDirty) writeNdjson(store.runsPath, store.runs);
    if (store.agentsDirty) writeNdjson(store.agentsPath, store.agents);
  }
}

function toolCloseResult(): { status: "error"; message: string } {
  return { status: "error", message: HOST_PROCESS_DIED_TOOL_MESSAGE };
}

function runningToolCloses(
  events: readonly TranscriptEvent[],
): TranscriptEventInput[] {
  const latestTool = new Map<
    string,
    Extract<TranscriptEvent, { type: "tool_call" }>
  >();
  for (const event of events) {
    if (event.type === "tool_call") latestTool.set(event.callId, event);
  }

  const closes: TranscriptEventInput[] = [];
  for (const event of latestTool.values()) {
    if (event.status !== "running") continue;
    closes.push({
      type: "tool_call",
      callId: event.callId,
      ...(event.name !== undefined ? { name: event.name } : {}),
      status: "error",
      result: toolCloseResult(),
    });
  }

  const latestNested = new Map<
    string,
    Extract<TranscriptEvent, { type: "subagent_update" }>
  >();
  for (const event of events) {
    if (event.type !== "subagent_update") continue;
    if (event.step.kind !== "tool_call") continue;
    latestNested.set(`${event.parentCallId}\0${event.step.callId}`, event);
  }
  for (const event of latestNested.values()) {
    if (event.step.kind !== "tool_call" || event.step.status !== "running") {
      continue;
    }
    const step = event.step;
    closes.push({
      type: "subagent_update",
      parentCallId: event.parentCallId,
      ...(event.delegationId !== undefined
        ? { delegationId: event.delegationId }
        : {}),
      ...(event.parentDelegationId !== undefined
        ? { parentDelegationId: event.parentDelegationId }
        : {}),
      step: {
        kind: "tool_call",
        callId: step.callId,
        ...(step.name !== undefined ? { name: step.name } : {}),
        status: "error",
        result: toolCloseResult(),
      },
    });
  }
  return closes;
}

async function scrubOrphan(conversationId: string): Promise<void> {
  const scrubbedAt = Date.now();
  const stores = readStores(conversationId);
  const { transcript } = readConversation(conversationId);
  const closes = runningToolCloses(transcript);
  const closedRun = scrubStores(stores, scrubbedAt);
  try {
    writeStores(stores);
  } finally {
    const root = agentStateDir(conversationId);
    if (statExists(root) && statSync(root).isDirectory()) {
      evictConversationStoreCaches(root);
    }
  }

  for (const event of closes) {
    await appendEvent(conversationId, event);
  }
  const alreadyRecovered = transcript.some(
    (event) => event.type === "host_crash_recovery",
  );
  if ((closedRun || closes.length > 0) && !alreadyRecovered) {
    await appendEvent(conversationId, {
      type: "host_crash_recovery",
      message: HOST_CRASH_RECOVERY_MESSAGE,
    });
  }
  clearRunLiveMarker(conversationId);
}

/**
 * Reconcile one conversation when its run-live marker names a dead process.
 * A missing marker, or a marker whose process is still live, is left alone.
 * The conversation lock is released when this returns, including on failure.
 */
export async function reconcileOrphanedConversation(
  conversationId: string,
): Promise<void> {
  await acquireConversationLock(conversationId);
  try {
    if (!runLiveMarkerExists(conversationId)) return;
    if (isRunLive(conversationId)) return;
    await scrubOrphan(conversationId);
  } finally {
    releaseConversationLock(conversationId);
  }
}

/**
 * Scan every conversation before the server accepts resume or send.
 * One conversation's failure is logged; the scan continues and this resolves.
 */
export async function scrubOrphanedRunsAtBoot(): Promise<void> {
  for (const conversationId of listConversationIds()) {
    try {
      await reconcileOrphanedConversation(conversationId);
    } catch (err) {
      console.error(
        `orphaned run scrub failed for conversation ${conversationId}:`,
        err,
      );
    }
  }
}
