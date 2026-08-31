import { useState } from "react";
import { Cloud, CloudOff, X } from "lucide-react";
import { Link } from "react-router-dom";
import { liveChip } from "@/components/ui/overlay-surfaces";
import {
  backupChipAccessibleLabel,
  backupChipIsWarning,
  formatBackupChipDuration,
} from "@/features/app-settings/lib/backup-surface";
import { useBackupQuery } from "@/features/app-settings/api/queries";
import {
  readBackupSetupNudgeDismissed,
  writeBackupSetupNudgeDismissed,
} from "@/lib/backup-setup-nudge";
import { cn } from "@/lib/utils/cn";

const browserStorage =
  typeof localStorage === "undefined" ? undefined : localStorage;

export const BACKUP_SETUP_NUDGE_LABEL = "Set up store backup";
export const BACKUP_SETUP_NUDGE_DISMISS_LABEL = "Dismiss backup setup nudge";

export function BackupChip() {
  const { data } = useBackupQuery();
  const [nudgeDismissed, setNudgeDismissed] = useState(() =>
    readBackupSetupNudgeDismissed(browserStorage),
  );
  const state = data?.status.state;
  if (!state) return null;
  if (state === "unconfigured") {
    if (nudgeDismissed) return null;
    return (
      <BackupSetupNudge
        onDismiss={() => {
          writeBackupSetupNudgeDismissed(true, browserStorage);
          setNudgeDismissed(true);
        }}
      />
    );
  }

  const { lastSuccessAt, error } = data.status;
  const warning = backupChipIsWarning(state);
  const label = backupChipAccessibleLabel(state, lastSuccessAt, error);
  const duration = formatBackupChipDuration(lastSuccessAt);

  return (
    <Link
      to="/settings"
      data-testid="backup-chip"
      data-backup-state={state}
      data-backup-warning={warning ? "true" : "false"}
      className={cn(
        liveChip,
        "min-w-0 shrink-0",
        warning &&
          "border-[hsl(var(--warning))] [color:hsl(var(--warning))] hover:[color:hsl(var(--warning))]",
      )}
      aria-label={label}
      title={label}
    >
      <Cloud aria-hidden className="h-3 w-3 shrink-0" strokeWidth={2} />
      <span className="truncate">{duration}</span>
    </Link>
  );
}

function BackupSetupNudge({ onDismiss }: { onDismiss: () => void }) {
  return (
    <span
      data-testid="backup-setup-nudge"
      className={cn(liveChip, "min-w-0 shrink-0")}
    >
      <Link
        to="/settings"
        className="inline-flex min-w-0 items-center gap-1.5 text-inherit no-underline hover:underline hover:underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={BACKUP_SETUP_NUDGE_LABEL}
        title={BACKUP_SETUP_NUDGE_LABEL}
      >
        <CloudOff aria-hidden className="h-3 w-3 shrink-0" strokeWidth={2} />
        <span className="truncate">Set up</span>
      </Link>
      <button
        type="button"
        data-testid="backup-setup-nudge-dismiss"
        aria-label={BACKUP_SETUP_NUDGE_DISMISS_LABEL}
        className="-mr-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch:size-11"
        onClick={onDismiss}
      >
        <X aria-hidden className="h-3 w-3" strokeWidth={2} />
      </button>
    </span>
  );
}
