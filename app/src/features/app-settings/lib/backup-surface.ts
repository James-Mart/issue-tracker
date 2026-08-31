import type { BackupSurfaceState } from "@server/services/store-backup-status";

export const STALE_COPY = "No snapshot has landed inside the threshold.";

const RETRYING_HINT =
  "Update the deploy key on GitHub or replace the remote URL, then save. Pushes retry with backoff until authentication succeeds.";

const DIVERGED_HINT =
  "This tracker mirrors one-way and will not merge a different store from the remote. Clone the remote elsewhere or point backup at an empty repository, then re-enable.";

const STALE_HINT = "Recent work is unprotected until a push succeeds.";

export type BackupProblem = {
  badge: { label: string; variant: "warn" | "blocked" };
  message: string;
  hint: string;
};

/** Problem chrome for retrying, diverged, and stale. Healthy and unconfigured have none. */
export function backupProblem(
  state: BackupSurfaceState,
  error: string | null,
): BackupProblem | null {
  if (state === "retrying") {
    return {
      badge: { label: "Retrying", variant: "warn" },
      message: error ?? RETRYING_HINT,
      hint: RETRYING_HINT,
    };
  }
  if (state === "diverged") {
    return {
      badge: { label: "Diverged", variant: "blocked" },
      message: error ?? DIVERGED_HINT,
      hint: DIVERGED_HINT,
    };
  }
  if (state === "stale") {
    return {
      badge: { label: "Stale", variant: "warn" },
      message: error ?? STALE_COPY,
      hint: error ? STALE_COPY : STALE_HINT,
    };
  }
  return null;
}

export function formatBackupLastPush(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Compact duration since last push for the top-bar chip (e.g. 2h, 45m). */
export function formatBackupChipDuration(
  lastSuccessAt: string | null,
  now: Date = new Date(),
): string {
  if (lastSuccessAt === null) return "—";
  const then = Date.parse(lastSuccessAt);
  if (Number.isNaN(then)) return "—";
  const ms = now.getTime() - then;
  if (ms < 0) return "—";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hours = Math.floor(min / 60);
  if (hours < 24 * 7) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/** Warning chip treatment — configured mirror not protecting data (not retrying). */
export function backupChipIsWarning(state: BackupSurfaceState): boolean {
  return state === "stale" || state === "diverged";
}

/** Load-bearing hover title and accessible label for the top-bar backup chip. */
export function backupChipAccessibleLabel(
  state: BackupSurfaceState,
  lastSuccessAt: string | null,
  error: string | null,
): string {
  if (state === "healthy") {
    if (lastSuccessAt) {
      return `Last backup push: ${formatBackupLastPush(lastSuccessAt)}`;
    }
    return "No backup push yet";
  }
  const problem = backupProblem(state, error);
  if (problem) return problem.message;
  if (lastSuccessAt) {
    return `Last backup push: ${formatBackupLastPush(lastSuccessAt)}`;
  }
  return "Backup mirror is not protecting data";
}
