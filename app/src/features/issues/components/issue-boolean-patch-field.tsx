import { useId } from "react";
import type { IssuePatch } from "@server/schemas";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useUpdateIssue } from "../api/mutations";
import { useIssuePatchAction } from "../hooks/use-issue-patch-action";

export function IssueBooleanPatchField({
  issueId,
  checked,
  labels,
  patchFor,
}: {
  issueId: string;
  checked: boolean;
  labels: { on: string; off: string };
  patchFor: (next: boolean) => IssuePatch;
}) {
  const update = useUpdateIssue();
  const { error, saving, run } = useIssuePatchAction();
  const id = useId();
  const stateLabel = checked ? labels.on : labels.off;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex h-7 items-center gap-2">
        <Switch
          id={id}
          checked={checked}
          disabled={saving}
          onCheckedChange={(next) => {
            if (next === checked) return;
            void run(async () => {
              await update.mutateAsync({
                id: issueId,
                patch: patchFor(next),
              });
            });
          }}
        />
        <Label htmlFor={id} className="cursor-pointer font-normal">
          {stateLabel}
        </Label>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
