import { readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { z } from "zod";
import { conversationsDir } from "../config.js";

const RUN_LIVE_MARKER = "run-live.json";

const runLiveMarkerSchema = z.object({
  pid: z.number().int().positive(),
});

function runLiveMarkerPath(conversationId: string): string {
  return join(conversationsDir, conversationId, RUN_LIVE_MARKER);
}

export function writeRunLiveMarker(conversationId: string): void {
  writeFileSync(
    runLiveMarkerPath(conversationId),
    `${JSON.stringify({ pid: process.pid })}\n`,
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
 * True when this conversation has a run-live marker whose pid is still
 * running. Any process that can see the conversations directory can ask —
 * not only the process that owns the in-memory session map.
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
  return isPidLive(result.data.pid);
}
