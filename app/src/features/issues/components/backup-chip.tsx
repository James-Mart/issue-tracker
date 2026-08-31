import { Cloud } from "lucide-react";
import { Link } from "react-router-dom";
import { liveChip } from "@/components/ui/overlay-surfaces";
import {
  backupChipAccessibleLabel,
  backupChipIsWarning,
  formatBackupChipDuration,
} from "@/features/app-settings/lib/backup-surface";
import { useBackupQuery } from "@/features/app-settings/api/queries";
import { cn } from "@/lib/utils/cn";

export function BackupChip() {
  const { data } = useBackupQuery();
  const state = data?.status.state;
  if (!state || state === "unconfigured") return null;

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
