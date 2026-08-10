import type { IssueDetail } from "@server/schemas";
import { useAgentModelsQuery } from "@/features/agents/api/queries";
import { useUpdateIssue } from "../api/mutations";
import { useIssuePatchAction } from "../hooks/use-issue-patch-action";
import { StakeholderSelect } from "./stakeholder-select";

export function IssueStakeholderField({
  issue,
}: {
  issue: Extract<IssueDetail, { kind: "idea" }>;
}) {
  const update = useUpdateIssue();
  const { error, saving, run } = useIssuePatchAction();
  const { data: modelsData, isLoading: modelsLoading } = useAgentModelsQuery();

  const onChange = (value: string | null) => {
    const current = issue.stakeholder;
    if (value === current || (value === null && current === undefined)) return;
    void run(async () => {
      await update.mutateAsync({
        id: issue.id,
        patch: { stakeholder: value },
      });
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <StakeholderSelect
        value={issue.stakeholder}
        models={modelsData?.models ?? []}
        loading={modelsLoading}
        disabled={saving}
        onChange={onChange}
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
