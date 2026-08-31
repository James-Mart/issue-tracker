import { PageShell, READING_MEASURE_CLASS } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import {
  ShellFaultDetail,
  ShellLoadingState,
  ShellState,
} from "@/app/shell-state";
import { cn } from "@/lib/utils/cn";
import { useBackupQuery } from "../api/queries";
import { BackupSettingsCard } from "./backup-settings-card";

function SettingsHeader() {
  return (
    <header>
      <p className="font-display text-[11px] font-semibold uppercase tracking-[0.22em] text-[hsl(var(--current))]">
        Settings
      </p>
      <h1 className="text-base font-semibold tracking-tight text-foreground">
        App settings
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Machine-wide configuration for this tracker instance. Additional
        sections can be added here as the product grows.
      </p>
    </header>
  );
}

export function AppSettingsPage() {
  const { data, isLoading, error, isFetching, refetch } = useBackupQuery();

  if (error) {
    return (
      <PageShell>
        <ShellState
          tone="blocked"
          eyebrow="Fault"
          title="Could not load settings"
          detail={
            <ShellFaultDetail
              message={error.message}
              hint="Check the server, then reload."
            />
          }
          action={
            <Button
              variant="primary"
              disabled={isFetching}
              onClick={() => {
                void refetch();
              }}
            >
              Reload
            </Button>
          }
        />
      </PageShell>
    );
  }

  if (isLoading || !data) {
    return (
      <PageShell>
        <ShellLoadingState label="Loading settings…" />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className={cn("flex flex-col gap-4", READING_MEASURE_CLASS)}>
        <SettingsHeader />
        <BackupSettingsCard backup={data} />
      </div>
    </PageShell>
  );
}
