import { useEffect, useState } from "react";
import type { IssueDetail } from "@server/schemas";
import { Input } from "@/components/ui/input";
import { useUpdateIssue } from "../api/mutations";
import { useIssuePatchAction } from "../hooks/use-issue-patch-action";

export function IssueMaxImplementingRunsField({
  issue,
}: {
  issue: Extract<IssueDetail, { kind: "project" }>;
}) {
  const update = useUpdateIssue();
  const { error, saving, run } = useIssuePatchAction();
  const [draft, setDraft] = useState(String(issue.maxImplementingRuns));
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(String(issue.maxImplementingRuns));
  }, [issue.maxImplementingRuns]);

  const commit = () => {
    const value = Number(draft);
    if (!Number.isInteger(value) || value < 1) {
      setLocalError("Enter an integer of 1 or more.");
      return;
    }
    setLocalError(null);
    if (value === issue.maxImplementingRuns) return;
    void run(async () => {
      await update.mutateAsync({
        id: issue.id,
        patch: { maxImplementingRuns: value },
      });
    });
  };

  const shown = localError ?? error;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Input
        type="number"
        min={1}
        step={1}
        inputMode="numeric"
        value={draft}
        disabled={saving}
        data-testid="max-implementing-runs"
        className="max-w-[6rem] font-mono tabular-nums"
        aria-label="Max implementing runs"
        onChange={(event) => {
          setDraft(event.target.value);
          setLocalError(null);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
      />
      {shown ? <p className="text-sm text-destructive">{shown}</p> : null}
    </div>
  );
}
