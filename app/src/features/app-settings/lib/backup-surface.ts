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
