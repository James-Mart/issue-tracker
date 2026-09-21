import { readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { z } from "zod";
import { bootId } from "../boot-info.js";
import { conversationsDir } from "../config.js";

const RUN_LIVE_MARKER = "run-live.json";

const runLiveMarkerSchema = z.object({
  pid: z.number().int().positive(),
  bootId: z.string().optional(),
  processStartedAt: z.number().int().nonnegative().optional(),
});

function runLiveMarkerPath(conversationId: string): string {
  return join(conversationsDir, conversationId, RUN_LIVE_MARKER);
}

/** Kernel start time from `/proc/<pid>/stat`, or null when the pid is gone. */
function readProcStartTime(pid: number): number | null {
  let stat: string;
  try {
    stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch {
    return null;
  }
  // The comm field is parenthesized and may itself contain spaces and parens,
  // so the numbered fields start after its closing paren.
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  const startTime = fields[19];
  if (!startTime) {
    throw new Error(`unparseable /proc/${pid}/stat`);
  }
  return Number(startTime);
}

export function writeRunLiveMarker(conversationId: string): void {
  const processStartedAt = readProcStartTime(process.pid);
  if (processStartedAt === null) {
    throw new Error(`unreadable process start time for pid ${process.pid}`);
  }
  writeFileSync(
    runLiveMarkerPath(conversationId),
    `${JSON.stringify({ pid: process.pid, bootId, processStartedAt })}\n`,
  );
}

export function clearRunLiveMarker(conversationId: string): void {
  rmSync(runLiveMarkerPath(conversationId), { force: true });
}

function isPidLive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw err;
  }
}

/**
 * True when this conversation has a run-live marker whose recorded
 * process identity is still live. Legacy markers that only store `{ pid }`
 * stay live while that pid is running. New markers also pin the process
 * kernel start time so a reused pid after restart is not treated as live.
 * Does not delete the marker when returning false.
 */
export function isRunLive(conversationId: string): boolean {
  const path = runLiveMarkerPath(conversationId);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new Error(
      `unreadable run-live marker at ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `unparseable run-live marker at ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const result = runLiveMarkerSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `unparseable run-live marker at ${path}: ${result.error.message}`,
    );
  }
  const { pid, bootId: markerBootId, processStartedAt } = result.data;
  if (!isPidLive(pid)) return false;
  if (markerBootId === undefined) return true;
  if (processStartedAt === undefined) return false;
  const currentStartTime = readProcStartTime(pid);
  if (currentStartTime === null) return false;
  return currentStartTime === processStartedAt;
}
