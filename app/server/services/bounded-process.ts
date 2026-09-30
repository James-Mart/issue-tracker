/**
 * Kill a process group, and keep only a bounded tail of command output in
 * memory. Worktree setup, stack readiness, and stack stop share these.
 */

/** Readiness already caps at these sizes. Callers pass them through unchanged. */
export const OUTPUT_TAIL_LIMIT = 64_000;
export const OUTPUT_TAIL_KEEP = 32_000;

/**
 * Append `chunk` and, once the result exceeds `limit` characters, retain the
 * last `keep`.
 */
export function appendOutputTail(
  tail: string,
  chunk: string,
  limit = OUTPUT_TAIL_LIMIT,
  keep = OUTPUT_TAIL_KEEP,
): string {
  const next = tail + chunk;
  if (next.length <= limit) return next;
  return next.slice(-keep);
}

/**
 * Signal process group `pgrp`. A child spawned with `detached: true` leads
 * that group, so its pid is the group id and the signal reaches grandchildren.
 * ESRCH means the group has already exited.
 */
export function killProcessGroup(
  pgrp: number,
  signal: NodeJS.Signals = "SIGKILL",
): void {
  try {
    process.kill(-pgrp, signal);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
  }
}
