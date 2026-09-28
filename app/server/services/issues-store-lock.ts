import { readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { issuesDir } from "../config.js";

const LOCK_RETRY_MS = 25;
const waitBuffer = new Int32Array(new SharedArrayBuffer(4));

let holdCount = 0;

function lockPath(): string {
  return join(issuesDir, ".store.lock");
}

function sleepRetry(): void {
  Atomics.wait(waitBuffer, 0, 0, LOCK_RETRY_MS);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw err;
  }
}

function readHolderPid(path: string): number | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  try {
    const parsed = JSON.parse(text) as { pid?: unknown };
    const pid = parsed.pid;
    if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return null;
    return pid;
  } catch {
    return null;
  }
}

function removeStaleLock(path: string): void {
  rmSync(path, { force: true });
}

function shouldRemoveLock(path: string): boolean {
  const pid = readHolderPid(path);
  if (pid === null) return true;
  if (pid === process.pid && holdCount === 0) return true;
  if (pid !== process.pid && !isProcessAlive(pid)) return true;
  return false;
}

function acquireLock(): void {
  const path = lockPath();
  for (;;) {
    try {
      writeFileSync(path, `${JSON.stringify({ pid: process.pid })}\n`, { flag: "wx" });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw err;
      const holderPid = readHolderPid(path);
      if (
        holderPid !== null &&
        holderPid !== process.pid &&
        isProcessAlive(holderPid)
      ) {
        sleepRetry();
        continue;
      }
      if (shouldRemoveLock(path)) {
        removeStaleLock(path);
      }
    }
  }
}

function releaseLock(): void {
  const path = lockPath();
  const pid = readHolderPid(path);
  if (pid === process.pid) {
    rmSync(path, { force: true });
  }
}

/** Cross-process mutex for the issues store directory. Reentrant within one process. */
export function withIssuesStoreLock<T>(fn: () => T): T {
  if (holdCount > 0) {
    holdCount++;
    try {
      return fn();
    } finally {
      holdCount--;
    }
  }
  acquireLock();
  holdCount = 1;
  try {
    return fn();
  } finally {
    holdCount--;
    if (holdCount === 0) {
      releaseLock();
    }
  }
}
