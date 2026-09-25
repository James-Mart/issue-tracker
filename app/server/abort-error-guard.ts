/**
 * `@cursor/sdk`'s stall detector cancels a run by calling
 * `AbortController.abort()`, and the resulting `AbortError` can escape the SDK
 * as an unhandled rejection (or a throw from an abort listener). Node treats
 * either as fatal, so one stalled run would take down every session. The run
 * itself still settles through `run.wait()`; only the stray error is dropped.
 */

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

export function installAbortErrorGuard(): void {
  process.on("unhandledRejection", (reason) => {
    if (isAbortError(reason)) {
      console.warn("[abort-guard] ignored unhandled AbortError", reason);
      return;
    }
    throw reason;
  });
  process.on("uncaughtException", (err) => {
    if (isAbortError(err)) {
      console.warn("[abort-guard] ignored uncaught AbortError", err);
      return;
    }
    console.error(err);
    process.exit(1);
  });
}
