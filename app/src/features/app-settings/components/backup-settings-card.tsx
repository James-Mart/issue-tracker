import { useEffect, useId, useState } from "react";
import { ShellInlineFault } from "@/app/shell-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  SETTINGS_HEADING_CLASS,
  SettingsCard,
} from "@/features/issues/components/detail-section";
import { MetaRow } from "@/features/issues/components/meta-row";
import { useUpdateBackup } from "../api/mutations";
import type { BackupResponse } from "../api/queries";
import {
  backupProblem,
  formatBackupLastPush,
} from "../lib/backup-surface";

const REMOTE_PLACEHOLDER = "git@github.com:you/issue-tracker-backup.git";

const REMOTE_DESCRIPTION =
  "Private Git repository this machine mirrors its store into. Pushes are one-way snapshots — restore is a documented clone-into-place runbook, not an action on this page.";

export function BackupSettingsCard({ backup }: { backup: BackupResponse }) {
  const update = useUpdateBackup();
  const enabledId = useId();
  const remoteId = useId();
  const savedRemote = backup.config.remote;
  const enabled = backup.config.enabled;
  const unconfigured = backup.status.state === "unconfigured";
  const problem = backupProblem(backup.status.state, backup.status.error);
  const [remoteDraft, setRemoteDraft] = useState(savedRemote ?? "");

  useEffect(() => {
    setRemoteDraft(savedRemote ?? "");
  }, [savedRemote]);

  const trimmedDraft = remoteDraft.trim();
  const canSave =
    trimmedDraft !== "" && trimmedDraft !== (savedRemote ?? "") && !update.isPending;
  const canToggle = savedRemote != null && !update.isPending;

  const persist = (remote: string, nextEnabled: boolean) => {
    void update.mutateAsync({ remote, enabled: nextEnabled });
  };

  return (
    <SettingsCard
      title="Backup"
      action={
        <div className="flex items-center gap-2">
          {problem ? (
            <Badge variant={problem.badge.variant}>{problem.badge.label}</Badge>
          ) : null}
          <div className="flex h-7 items-center gap-2">
            <Switch
              id={enabledId}
              checked={enabled}
              disabled={!canToggle}
              onCheckedChange={(next) => {
                if (savedRemote == null || next === enabled) return;
                persist(savedRemote, next);
              }}
            />
            <Label htmlFor={enabledId} className="cursor-pointer font-normal">
              {enabled ? "Enabled" : "Disabled"}
            </Label>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor={remoteId} className={SETTINGS_HEADING_CLASS}>
            Snapshot remote
          </Label>
          <p className="text-sm text-muted-foreground">{REMOTE_DESCRIPTION}</p>
          <Input
            id={remoteId}
            data-testid="backup-remote-input"
            className="font-mono"
            value={remoteDraft}
            placeholder={REMOTE_PLACEHOLDER}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setRemoteDraft(event.target.value)}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              disabled={!canSave}
              onClick={() => persist(trimmedDraft, enabled)}
            >
              Save remote
            </Button>
            {unconfigured ? (
              <p className="text-sm text-muted-foreground">
                Enable backup after the remote is saved.
              </p>
            ) : null}
          </div>
        </div>

        {unconfigured ? null : (
          <div className="flex flex-col gap-2">
            <p className={SETTINGS_HEADING_CLASS}>Snapshot state</p>
            <MetaRow
              label="Last push"
              value={
                backup.status.lastSuccessAt ? (
                  <time
                    className="font-mono"
                    dateTime={backup.status.lastSuccessAt}
                  >
                    {formatBackupLastPush(backup.status.lastSuccessAt)}
                  </time>
                ) : (
                  "Never"
                )
              }
            />
          </div>
        )}

        {problem ? (
          <ShellInlineFault message={problem.message} hint={problem.hint} />
        ) : null}
      </div>
    </SettingsCard>
  );
}
