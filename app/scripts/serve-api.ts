#!/usr/bin/env -S npx tsx
/**
 * Supervise the API child for `npm run serve`: re-spawn only on the sentinel
 * exit; propagate every other termination to concurrently and the shell.
 *
 * The child's output is also written, timestamped, to one log file per spawn
 * in `logsDir`, and each exit is recorded there — the terminal scrollback is
 * otherwise the only record of why the API died.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, mkdirSync, openSync, readdirSync, rmSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { logsDir } from "../server/config.js";
import {
  RESTART_SUPERVISED_ENV_VAR,
  shouldRespawn,
} from "../server/restart-contract.js";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEPT_API_LOGS = 20;

function pruneApiLogs(): void {
  const logs = readdirSync(logsDir)
    .filter((name) => name.startsWith("api-") && name.endsWith(".log"))
    .sort();
  for (const name of logs.slice(0, Math.max(0, logs.length - KEPT_API_LOGS))) {
    rmSync(join(logsDir, name), { force: true });
  }
}

type LineStamper = { write(chunk: Buffer): void; flush(): void };

/** Line-buffered so each line gets the time it arrived, not the time its chunk started. */
function lineStamper(fd: number): LineStamper {
  let partial = "";
  const emit = (lines: string[]) => {
    const at = new Date().toISOString();
    writeSync(fd, lines.map((line) => `${at} ${line}\n`).join(""));
  };
  return {
    write(chunk) {
      const lines = (partial + chunk.toString("utf8")).split("\n");
      partial = lines.pop() ?? "";
      if (lines.length > 0) emit(lines);
    },
    flush() {
      if (partial) emit([partial]);
      partial = "";
    },
  };
}

function openApiLog(): { fd: number; path: string } {
  mkdirSync(logsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(logsDir, `api-${stamp}-${process.pid}.log`);
  const fd = openSync(path, "a");
  pruneApiLogs();
  return { fd, path };
}

/**
 * Descendants that inherited the child's stdout can hold the pipe open past
 * its exit, so `close` alone could stall the supervisor; this bounds the wait
 * for the child's last output.
 */
const STDIO_DRAIN_MS = 500;

function spawnApiChild(
  onExit: (code: number | null, signal: NodeJS.Signals | null) => void,
): ChildProcess {
  const log = openApiLog();
  const spawnedAt = Date.now();
  const next = spawn("tsx", ["server/index.ts"], {
    cwd: appDir,
    stdio: ["inherit", "pipe", "pipe"],
    env: { ...process.env, [RESTART_SUPERVISED_ENV_VAR]: "1" },
  });
  const out = lineStamper(log.fd);
  const err = lineStamper(log.fd);
  next.stdout!.on("data", (chunk: Buffer) => {
    process.stdout.write(chunk);
    out.write(chunk);
  });
  next.stderr!.on("data", (chunk: Buffer) => {
    process.stderr.write(chunk);
    err.write(chunk);
  });
  console.error(`[serve-api] API pid ${next.pid} logging to ${log.path}`);

  next.once("exit", (code, signal) => {
    let recorded = false;
    const record = () => {
      if (recorded) return;
      recorded = true;
      clearTimeout(drainTimer);
      out.flush();
      err.flush();
      const uptimeSec = Math.round((Date.now() - spawnedAt) / 1000);
      const line =
        `[serve-api] API pid ${next.pid} exited code=${code} signal=${signal} ` +
        `after ${uptimeSec}s`;
      console.error(line);
      writeSync(log.fd, `${new Date().toISOString()} ${line}\n`);
      closeSync(log.fd);
      onExit(code, signal);
    };
    const drainTimer = setTimeout(record, STDIO_DRAIN_MS);
    next.once("close", record);
  });
  return next;
}

function propagateExit(code: number | null, signal: NodeJS.Signals | null): void {
  process.removeAllListeners("SIGINT");
  process.removeAllListeners("SIGTERM");
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
}

let forwardingSignal = false;

function onChildExit(code: number | null, signal: NodeJS.Signals | null): void {
  if (shouldRespawn({ code, signal })) {
    forwardingSignal = false;
    child = spawnApiChild(onChildExit);
    return;
  }
  propagateExit(code, signal);
}

let child = spawnApiChild(onChildExit);

process.on("SIGINT", () => {
  if (forwardingSignal || child.killed) return;
  forwardingSignal = true;
  child.kill("SIGINT");
});
process.on("SIGTERM", () => {
  if (forwardingSignal || child.killed) return;
  forwardingSignal = true;
  child.kill("SIGTERM");
});
