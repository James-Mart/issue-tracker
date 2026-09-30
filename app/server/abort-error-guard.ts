/**
 * Errors `@cursor/sdk` can let escape as an unhandled rejection (or a throw
 * from a listener) that concern one run, not the process. Node treats either
 * as fatal, so one bad run would take down every session.
 *
 * - `AbortError`: the stall detector cancels a run via `AbortController.abort()`.
 *   The run itself still settles through `run.wait()`.
 * - Spawn `ENOENT`: the SDK shell tool persists each command's final `pwd` as
 *   the next command's cwd. When that directory is removed (e.g. a Story
 *   worktree deleted by merge), the next spawn fails with
 *   `spawn /bin/bash ENOENT`. Only that tool call fails.
 *
 * Anything else is fatal, and leaves a crash report in `logsDir`.
 */

import { writeCrashReport } from "./crash-report.js";

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

export function isSpawnEnoent(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const { code, syscall } = err as NodeJS.ErrnoException;
  return code === "ENOENT" && typeof syscall === "string" && syscall.startsWith("spawn");
}

function survivableLabel(err: unknown): string | null {
  if (isAbortError(err)) return "AbortError";
  if (isSpawnEnoent(err)) return "spawn ENOENT";
  return null;
}

function exitFatally(err: unknown, origin: string): never {
  console.error(`[abort-guard] fatal ${origin}:`, err);
  const reportPath = writeCrashReport(err, origin);
  console.error(
    reportPath
      ? `[abort-guard] crash report written to ${reportPath}`
      : "[abort-guard] crash report could not be written",
  );
  process.exit(1);
}

export function installAbortErrorGuard(): void {
  process.on("unhandledRejection", (reason) => {
    const label = survivableLabel(reason);
    if (label) {
      console.warn(`[abort-guard] ignored unhandled ${label}`, reason);
      return;
    }
    exitFatally(reason, "unhandledRejection");
  });
  process.on("uncaughtException", (err, origin) => {
    const label = survivableLabel(err);
    if (label) {
      console.warn(`[abort-guard] ignored uncaught ${label}`, err);
      return;
    }
    exitFatally(err, origin);
  });
}
