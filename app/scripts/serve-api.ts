#!/usr/bin/env -S npx tsx
/**
 * Supervise the API child for `npm run serve`: re-spawn only on the sentinel
 * exit; propagate every other termination to concurrently and the shell.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RESTART_SUPERVISED_ENV_VAR,
  shouldRespawn,
} from "../server/restart-contract.js";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");

function spawnApiChild(): ChildProcess {
  return spawn("tsx", ["server/index.ts"], {
    cwd: appDir,
    stdio: "inherit",
    env: { ...process.env, [RESTART_SUPERVISED_ENV_VAR]: "1" },
  });
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

let child = spawnApiChild();
let forwardingSignal = false;

function onChildExit(code: number | null, signal: NodeJS.Signals | null): void {
  if (shouldRespawn({ code, signal })) {
    forwardingSignal = false;
    child = spawnApiChild();
    child.on("exit", onChildExit);
    return;
  }
  propagateExit(code, signal);
}

child.on("exit", onChildExit);

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
