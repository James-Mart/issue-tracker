import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { backupStatusPath } from "../config.js";

export const BACKUP_STALE_AFTER_MS = 24 * 60 * 60 * 1000;
export const BACKUP_RETRY_INITIAL_MS = 1_000;
export const BACKUP_RETRY_MAX_MS = 60_000;

export const BACKUP_ENGINE_STATES = ["idle", "retrying", "diverged"] as const;

export type BackupEngineState = (typeof BACKUP_ENGINE_STATES)[number];

export const BACKUP_SURFACE_STATES = [
  "unconfigured",
  "stale",
  "retrying",
  "diverged",
  "healthy",
] as const;

export type BackupSurfaceState = (typeof BACKUP_SURFACE_STATES)[number];

export type BackupEngineStatus = {
  lastSuccessAt: string | null;
  state: BackupEngineState;
  error: string | null;
};

export type PushWithRetryOptions = {
  push: () => Promise<"pushed" | "refused">;
  refusalMessage: () => string;
  statusPath?: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isEngineState(value: unknown): value is BackupEngineState {
  return value === "idle" || value === "retrying" || value === "diverged";
}

export function parseBackupStatus(raw: string): BackupEngineStatus {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("backup-status.json is not valid JSON");
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    !("lastSuccessAt" in parsed) ||
    !("state" in parsed) ||
    !("error" in parsed)
  ) {
    throw new Error("backup-status.json is missing required fields");
  }
  const lastSuccessAt = parsed.lastSuccessAt;
  if (lastSuccessAt !== null) {
    if (typeof lastSuccessAt !== "string" || Number.isNaN(Date.parse(lastSuccessAt))) {
      throw new Error("backup-status.json lastSuccessAt is not an ISO timestamp");
    }
  }
  if (!isEngineState(parsed.state)) {
    throw new Error("backup-status.json state is not idle, retrying, or diverged");
  }
  if (parsed.error !== null && typeof parsed.error !== "string") {
    throw new Error("backup-status.json error is not a string or null");
  }
  return {
    lastSuccessAt,
    state: parsed.state,
    error: parsed.error,
  };
}

export function formatBackupStatus(status: BackupEngineStatus): string {
  return `${JSON.stringify(
    {
      lastSuccessAt: status.lastSuccessAt,
      state: status.state,
      error: status.error,
    },
    null,
    2,
  )}\n`;
}

const emptyStatus = (): BackupEngineStatus => ({
  lastSuccessAt: null,
  state: "idle",
  error: null,
});

export function readBackupStatus(
  path: string = backupStatusPath,
): BackupEngineStatus {
  if (!existsSync(path)) return emptyStatus();
  return parseBackupStatus(readFileSync(path, "utf8"));
}

export function writeBackupStatus(
  status: BackupEngineStatus,
  path: string = backupStatusPath,
): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, formatBackupStatus(status));
}

/**
 * Surface state a caller renders. `unconfigured` / `stale` / `healthy` are
 * derived from the remote and timestamps; `retrying` / `diverged` come from
 * the engine record.
 */
export function deriveBackupSurfaceState(
  remote: string | null | undefined,
  engine: BackupEngineStatus,
): BackupSurfaceState {
  if (remote == null) return "unconfigured";
  if (engine.state === "retrying") return "retrying";
  if (engine.state === "diverged") return "diverged";
  if (isBackupStale(engine.lastSuccessAt, new Date())) return "stale";
  return "healthy";
}

/** Stale when there has never been a success, or the last one is older than 24h. */
export function isBackupStale(
  lastSuccessAt: string | null,
  now: Date,
  thresholdMs: number = BACKUP_STALE_AFTER_MS,
): boolean {
  if (lastSuccessAt === null) return true;
  const then = Date.parse(lastSuccessAt);
  return now.getTime() - then >= thresholdMs;
}

function persist(
  path: string,
  lastSuccessAt: string | null,
  state: BackupEngineState,
  error: string | null,
): void {
  writeBackupStatus({ lastSuccessAt, state, error }, path);
}

/**
 * Retry a mirror push with exponential backoff. Divergence is recorded and
 * not retried; transient failures keep the previous lastSuccessAt.
 */
export async function pushWithRetry(
  options: PushWithRetryOptions,
): Promise<"pushed" | "refused"> {
  const path = options.statusPath ?? backupStatusPath;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? (() => new Date());
  const initialBackoffMs = options.initialBackoffMs ?? BACKUP_RETRY_INITIAL_MS;
  const maxBackoffMs = options.maxBackoffMs ?? BACKUP_RETRY_MAX_MS;
  let lastSuccessAt = readBackupStatus(path).lastSuccessAt;
  let backoffMs = initialBackoffMs;

  for (;;) {
    let result: "pushed" | "refused";
    try {
      result = await options.push();
    } catch (err) {
      if (!(err instanceof Error)) throw err;
      persist(path, lastSuccessAt, "retrying", err.message);
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, maxBackoffMs);
      continue;
    }
    if (result === "refused") {
      persist(path, lastSuccessAt, "diverged", options.refusalMessage());
      return "refused";
    }
    lastSuccessAt = now().toISOString();
    persist(path, lastSuccessAt, "idle", null);
    return "pushed";
  }
}
