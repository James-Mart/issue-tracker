#!/usr/bin/env -S npx tsx
// `npm test` entry.
//
// Full run: the lint chain, then `vitest run`.
// `npm test -- <path...>`: `vitest run <path...>` only.
// Either way, one child process group, killed at three minutes (exit 124).

import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

const LINT_SCRIPTS = [
  "lint:boundary",
  "lint:spawns",
  "lint:cli-forms",
  "lint:skill-paths",
  "lint:pipeline-shape",
  "lint:transport",
  "lint:file-length",
] as const;

export const UNIT_SUITE_DEADLINE_MS = 180_000;

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

/**
 * Resolves with the child's exit code when the child exits first.
 * When `deadlineMs` elapses first, kills the child's process group
 * (grandchildren included) and resolves 124.
 */
export function runWithDeadline(options: {
  command: string;
  args: string[];
  cwd: string;
  deadlineMs: number;
}): Promise<number> {
  const { command, args, cwd, deadlineMs } = options;
  return new Promise((resolve, reject) => {
    // New process group so a deadline kill reaches grandchildren.
    const child = spawn(command, args, {
      cwd,
      detached: true,
      stdio: "inherit",
    });

    let settled = false;
    let killed = false;

    const timer = setTimeout(() => {
      const pid = child.pid;
      if (pid === undefined || settled) return;
      try {
        process.kill(-pid, "SIGKILL");
        killed = true;
      } catch (err) {
        const errno = (err as NodeJS.ErrnoException).code;
        // The child already exited; the exit handler reports its code.
        if (errno !== "ESRCH") {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      }
    }, deadlineMs);

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killed) {
        resolve(124);
        return;
      }
      if (code === null) {
        reject(new Error(`child exited from signal ${signal ?? "unknown"}`));
        return;
      }
      resolve(code);
    });
  });
}

async function main(): Promise<void> {
  const { command, args } = unitSuiteCommand(process.argv.slice(2));
  const code = await runWithDeadline({
    command,
    args,
    cwd: APP_DIR,
    deadlineMs: UNIT_SUITE_DEADLINE_MS,
  });
  process.exit(code);
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
