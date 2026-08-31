export const BACKUP_SETUP_NUDGE_STORAGE_KEY = "backup-setup-nudge-dismissed";

export function parseBackupSetupNudgeDismissed(
  value: string | null | undefined,
): boolean {
  return value === "1";
}

export function readBackupSetupNudgeDismissed(
  storage?: Pick<Storage, "getItem">,
): boolean {
  if (!storage) return false;
  return parseBackupSetupNudgeDismissed(
    storage.getItem(BACKUP_SETUP_NUDGE_STORAGE_KEY),
  );
}

export function writeBackupSetupNudgeDismissed(
  dismissed: boolean,
  storage?: Pick<Storage, "setItem">,
): void {
  storage?.setItem(BACKUP_SETUP_NUDGE_STORAGE_KEY, dismissed ? "1" : "0");
}
