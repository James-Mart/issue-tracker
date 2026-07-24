import type { IssuePatch } from "@server/schemas";
import { Checkbox } from "@/components/ui/checkbox";
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

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label className="flex h-7 items-center gap-2 text-sm">
        <Checkbox
          checked={checked}
          disabled={saving}
          onCheckedChange={(value) => {
            const next = value === true;
            if (next === checked) return;
            void run(async () => {
              await update.mutateAsync({
                id: issueId,
                patch: patchFor(next),
              });
            });
          }}
        />
        {checked ? labels.on : labels.off}
      </label>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
