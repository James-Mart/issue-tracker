#!/usr/bin/env -S npx tsx
// `npm test` entry.
//
// Full run: the lint chain, then `typecheck`, then `vitest run`.
// `npm test -- <path...>`: `vitest run <path...>` only.
// Either way, one child process group, killed at three minutes (exit 124).
// This process subreaps descendants as they exit. A deadline SIGKILLs the
// group and resolves 124 once it is collected. SIGINT and SIGTERM use the
// stop sequence and exit only after the group is collected.

import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ensureChildReaper, reapExitedChildren } from "../server/services/child-reaper.js";

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

const LINT_SCRIPTS = [
  "lint:boundary",
  "lint:spawns",
  "lint:cli-forms",
  "lint:skill-paths",
  "lint:pipeline-shape",
  "lint:transport",
  "lint:file-length",
  "typecheck",
] as const;

export const UNIT_SUITE_DEADLINE_MS = 180_000;

const TERM_GRACE_MS = 8_000;
const KILL_GRACE_MS = 2_000;
const EXIT_POLL_MS = 100;

type RecordedGroup = { pid: number; pgrp: number };

let recorded: RecordedGroup | undefined;
let handlingSignal = false;
let activeDeadlineTimer: ReturnType<typeof setTimeout> | undefined;

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Child argv for a full suite run, or for `vitest run` of the given paths. */
export function unitSuiteCommand(extraArgs: string[]): {
  command: string;
  args: string[];
} {
  const vitest = join(APP_DIR, "node_modules", ".bin", "vitest");
  if (extraArgs.length > 0) {
    return { command: vitest, args: ["run", ...extraArgs] };
  }
  const chain = [
    ...LINT_SCRIPTS.map((name) => `npm run ${name}`),
    `${quoteShell(vitest)} run`,
  ].join(" && ");
  return { command: "sh", args: ["-c", chain] };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readProcInfo(
  pid: number,
): { state: string; ppid: number; pgrp: number } | null {
  let stat: string;
  try {
    stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch {
    return null;
  }
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  const state = fields[0];
  const ppid = Number(fields[1]);
  const pgrp = Number(fields[2]);
  if (!state || !Number.isInteger(ppid) || !Number.isInteger(pgrp)) {
    throw new Error(`unparseable /proc/${pid}/stat`);
  }
  return { state, ppid, pgrp };
}

function signalGroup(pgrp: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pgrp, signal);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
  }
}

/** True when any child of this process still belongs to one of these groups. */
function groupsHaveOurChildren(groups: ReadonlySet<number>): boolean {
  if (groups.size === 0) return false;
  let entries: string[];
  try {
    entries = readdirSync("/proc");
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (!/^[1-9]\d*$/.test(entry)) continue;
    const info = readProcInfo(Number(entry));
    if (!info) continue;
    if (info.ppid === process.pid && groups.has(info.pgrp)) return true;
  }
  return false;
}

/**
 * Collection is `waitpid`, not state Z. `timeoutMs` is how long to wait before
 * reporting that the group is still uncollected. `Infinity` waits until
 * `waitpid` collects it.
 */
async function waitUntilGroupsCollected(
  groups: ReadonlySet<number>,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    reapExitedChildren();
    if (!groupsHaveOurChildren(groups)) return true;
    if (Date.now() >= deadline) return false;
    await delay(EXIT_POLL_MS);
  }
}

/**
 * Stop sequence for the recorded deadline group. A pid that is not this
 * process's child is dropped with no signal. The process exits 0 when the
 * group is collected within the sequence. Past `KILL_GRACE_MS` the failure
 * is written to stderr and the process exits 1 only after `waitpid`
 * collects the group.
 */
export async function exitAfterDeadlineStop(pid: number | undefined): Promise<void> {
  ensureChildReaper();
  let code = 0;
  const remembered = pid !== undefined && recorded?.pid === pid ? recorded : undefined;
  if (pid !== undefined) {
    const info = readProcInfo(pid);
    if (info && info.ppid === process.pid && info.state !== "Z") {
      const groups = new Set<number>([info.pgrp]);
      signalGroup(info.pgrp, "SIGTERM");
      const collectedOnTerm = await waitUntilGroupsCollected(groups, TERM_GRACE_MS);
      if (!collectedOnTerm) {
        signalGroup(info.pgrp, "SIGKILL");
        const collectedOnKill = await waitUntilGroupsCollected(groups, KILL_GRACE_MS);
        if (!collectedOnKill) {
          await waitUntilGroupsCollected(groups, Number.POSITIVE_INFINITY);
          console.error(`test deadline group survived SIGKILL (pid ${pid})`);
          code = 1;
        }
      }
    } else if (info && info.ppid === process.pid) {
      await waitUntilGroupsCollected(new Set([info.pgrp]), Number.POSITIVE_INFINITY);
    } else if (remembered && info === null) {
      await waitUntilGroupsCollected(
        new Set([remembered.pgrp]),
        Number.POSITIVE_INFINITY,
      );
    }
  }
  if (remembered && recorded?.pid === remembered.pid) recorded = undefined;
  process.exit(code);
}

function handleDeadlineSignal(): void {
  if (handlingSignal) return;
  handlingSignal = true;
  if (activeDeadlineTimer) clearTimeout(activeDeadlineTimer);
  const pid = recorded?.pid;
  void exitAfterDeadlineStop(pid).catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}

/**
 * Resolves with the child's exit code when the child exits first.
 * When `deadlineMs` elapses first, SIGKILLs the child's process group
 * and resolves 124 once that group is collected.
 */
export function runWithDeadline(options: {
  command: string;
  args: string[];
  cwd: string;
  deadlineMs: number;
}): Promise<number> {
  const { command, args, cwd, deadlineMs } = options;
  ensureChildReaper();
  return new Promise((resolvePromise, reject) => {
    // New process group so a deadline kill reaches grandchildren.
    const child = spawn(command, args, {
      cwd,
      detached: true,
      stdio: "inherit",
    });
    if (child.pid !== undefined) {
      const info = readProcInfo(child.pid);
      recorded = { pid: child.pid, pgrp: info?.pgrp ?? child.pid };
    }

    let settled = false;
    let killed = false;
    let killedGroups: ReadonlySet<number> | null = null;

    activeDeadlineTimer = setTimeout(() => {
      const pid = child.pid;
      if (pid === undefined || settled || handlingSignal) return;
      const info = readProcInfo(pid);
      const pgrp = info?.pgrp ?? pid;
      killed = true;
      killedGroups = new Set([pgrp]);
      try {
        process.kill(-pgrp, "SIGKILL");
      } catch (err) {
        const errno = (err as NodeJS.ErrnoException).code;
        // The child already exited; the exit handler reports its code.
        if (errno !== "ESRCH") {
          settled = true;
          clearTimeout(activeDeadlineTimer);
          reject(err);
        }
      }
    }, deadlineMs);

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(activeDeadlineTimer);
      reject(err);
    });

    child.on("exit", (code, signal) => {
      if (settled) return;
      if (handlingSignal) {
        settled = true;
        clearTimeout(activeDeadlineTimer);
        resolvePromise(0);
        return;
      }
      if (killed && killedGroups) {
        const groups = killedGroups;
        void (async () => {
          try {
            await waitUntilGroupsCollected(groups, Number.POSITIVE_INFINITY);
          } catch (err) {
            if (settled) return;
            settled = true;
            clearTimeout(activeDeadlineTimer);
            if (recorded?.pid === child.pid) recorded = undefined;
            reject(err instanceof Error ? err : new Error(String(err)));
            return;
          }
          if (settled) return;
          settled = true;
          clearTimeout(activeDeadlineTimer);
          if (recorded?.pid === child.pid) recorded = undefined;
          resolvePromise(124);
        })();
        return;
      }
      if (recorded?.pid === child.pid) recorded = undefined;
      settled = true;
      clearTimeout(activeDeadlineTimer);
      if (code === null) {
        reject(new Error(`child exited from signal ${signal ?? "unknown"}`));
        return;
      }
      resolvePromise(code);
    });
  });
}

async function main(): Promise<void> {
  process.on("SIGINT", handleDeadlineSignal);
  process.on("SIGTERM", handleDeadlineSignal);
  const { command, args } = unitSuiteCommand(process.argv.slice(2));
  try {
    const code = await runWithDeadline({
      command,
      args,
      cwd: APP_DIR,
      deadlineMs: UNIT_SUITE_DEADLINE_MS,
    });
    if (handlingSignal) return;
    process.exit(code);
  } catch (err) {
    if (handlingSignal) return;
    console.error(err);
    process.exit(1);
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
