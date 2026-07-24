import type { IssueDetail, MergePolicy } from "@server/schemas";
import { useUpdateIssue } from "../api/mutations";
import { useIssuePatchAction } from "../hooks/use-issue-patch-action";
import { MergePolicySelect } from "./merge-policy-select";

export function IssueMergePolicyField({
  issue,
}: {
  issue: Extract<IssueDetail, { kind: "project" }>;
}) {
  const update = useUpdateIssue();
  const { error, saving, run } = useIssuePatchAction();

  const onChange = (value: MergePolicy) => {
    if (value === issue.mergePolicy) return;
    void run(async () => {
      await update.mutateAsync({
        id: issue.id,
        patch: { mergePolicy: value },
      });
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <MergePolicySelect
        value={issue.mergePolicy}
        disabled={saving}
        onChange={onChange}
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
