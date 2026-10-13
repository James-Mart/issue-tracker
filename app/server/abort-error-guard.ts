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
 * - Network `ConnectError`: before every shell command the SDK looks up the
 *   team repo blocklist over RPC and does not catch a transport failure, so a
 *   momentary `ECONNRESET` escapes from that one tool call.
 * - Unavailable `ConnectError`: the same calls escape a Connect `unavailable`
 *   (code 14) when Cursor's backend is down. The connection succeeded, so
 *   there is no errno in the cause chain. The browser is told Cursor is having
 *   issues.
 *
 * Anything else is fatal, and leaves a crash report in `logsDir`.
 */

import { writeCrashReport } from "./crash-report.js";

const NETWORK_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EAI_AGAIN",
]);

const MAX_CAUSE_DEPTH = 8;

/** `Code.Unavailable` from `@connectrpc/connect`. */
const CONNECT_CODE_UNAVAILABLE = 14;

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

export function isSpawnEnoent(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const { code, syscall } = err as NodeJS.ErrnoException;
  return code === "ENOENT" && typeof syscall === "string" && syscall.startsWith("spawn");
}

/** A Connect RPC error whose cause chain bottoms out in a transport errno. */
export function isNetworkConnectError(err: unknown): boolean {
  if (!(err instanceof Error) || err.name !== "ConnectError") return false;
  let current: unknown = err;
  for (let depth = 0; current instanceof Error && depth < MAX_CAUSE_DEPTH; depth++) {
    const { code } = current as NodeJS.ErrnoException;
    if (typeof code === "string" && NETWORK_ERROR_CODES.has(code)) return true;
    current = current.cause;
  }
  return false;
}

/** A Connect RPC error the Cursor backend answered with `unavailable`. */
export function isUnavailableConnectError(err: unknown): boolean {
  if (!(err instanceof Error) || err.name !== "ConnectError") return false;
  return (err as { code?: unknown }).code === CONNECT_CODE_UNAVAILABLE;
}

function survivableLabel(err: unknown): string | null {
  if (isAbortError(err)) return "AbortError";
  if (isSpawnEnoent(err)) return "spawn ENOENT";
  if (isNetworkConnectError(err)) return "network ConnectError";
  if (isUnavailableConnectError(err)) return "unavailable ConnectError";
  return null;
}

function noticeSurvived(err: unknown): void {
  if (!isUnavailableConnectError(err)) return;
  void import("./services/cursor-service-events.js")
    .then(({ publishCursorUnavailable }) => publishCursorUnavailable())
    .catch((publishErr: unknown) => {
      console.error("[abort-guard] cursor-unavailable notice failed", publishErr);
    });
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
      noticeSurvived(reason);
      return;
    }
    exitFatally(reason, "unhandledRejection");
  });
  process.on("uncaughtException", (err, origin) => {
    const label = survivableLabel(err);
    if (label) {
      console.warn(`[abort-guard] ignored uncaught ${label}`, err);
      noticeSurvived(err);
      return;
    }
    exitFatally(err, origin);
  });
}
