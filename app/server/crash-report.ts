import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { bootId, processStartedAt } from "./boot-info.js";
import { conversationsDir, logsDir } from "./config.js";

const MAX_CAUSE_DEPTH = 8;

type SerializedError = {
  name?: string;
  message: string;
  stack?: string;
  code?: unknown;
  errno?: unknown;
  syscall?: unknown;
  path?: unknown;
  rawMessage?: unknown;
};

export type CrashReport = {
  at: string;
  bootId: string;
  pid: number;
  uptimeSec: number;
  origin: string;
  memory: NodeJS.MemoryUsage;
  /** Outermost first; each entry is the previous entry's `cause`. */
  errorChain: SerializedError[];
  /** Conversations whose run-live marker names this process. */
  liveConversations: string[];
};

function serializeOne(err: unknown): SerializedError {
  if (!(err instanceof Error)) return { message: String(err) };
  const extra = err as Error & Record<string, unknown>;
  const out: SerializedError = { name: err.name, message: err.message };
  if (err.stack) out.stack = err.stack;
  for (const key of ["code", "errno", "syscall", "path", "rawMessage"] as const) {
    if (extra[key] !== undefined) out[key] = extra[key];
  }
  return out;
}

export function serializeErrorChain(err: unknown): SerializedError[] {
  const chain: SerializedError[] = [];
  let current: unknown = err;
  while (current !== undefined && chain.length < MAX_CAUSE_DEPTH) {
    chain.push(serializeOne(current));
    current = current instanceof Error ? current.cause : undefined;
  }
  return chain;
}

function liveConversationsForThisBoot(): string[] {
  let ids: string[];
  try {
    ids = readdirSync(conversationsDir);
  } catch {
    return [];
  }
  return ids.filter((id) => {
    try {
      const marker = JSON.parse(
        readFileSync(join(conversationsDir, id, "run-live.json"), "utf8"),
      ) as { bootId?: unknown };
      return marker.bootId === bootId;
    } catch {
      return false;
    }
  });
}

export function buildCrashReport(err: unknown, origin: string): CrashReport {
  return {
    at: new Date().toISOString(),
    bootId,
    pid: process.pid,
    uptimeSec: Math.round((Date.now() - processStartedAt) / 1000),
    origin,
    memory: process.memoryUsage(),
    errorChain: serializeErrorChain(err),
    liveConversations: liveConversationsForThisBoot(),
  };
}

/**
 * Synchronous so it lands before `process.exit`. Returns the written path, or
 * null when the report itself could not be written — a crash report must never
 * be what masks the crash.
 */
export function writeCrashReport(err: unknown, origin: string): string | null {
  try {
    const report = buildCrashReport(err, origin);
    mkdirSync(logsDir, { recursive: true });
    const path = join(
      logsDir,
      `crash-${report.at.replace(/[:.]/g, "-")}-${bootId}.json`,
    );
    writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
    return path;
  } catch {
    return null;
  }
}
