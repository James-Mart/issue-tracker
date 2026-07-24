import type { IssueDetail } from "@server/schemas";
import { useUpdateIssue } from "../api/mutations";
import { InlineField } from "./inline-field";

export function IssueAssigneeField({
  issue,
}: {
  issue: Extract<IssueDetail, { kind: "task" }>;
}) {
  const update = useUpdateIssue();

  return (
    <InlineField
      value={issue.assignee ?? ""}
      issue={issue}
      emptyLabel="unassigned"
      displayClassName="font-mono"
      inputClassName="font-mono"
      onSave={async (next) => {
        const trimmed = next.trim();
        const current = issue.assignee ?? "";
        if (trimmed === current) return;
        await update.mutateAsync({
          id: issue.id,
          patch: { assignee: trimmed === "" ? null : trimmed },
        });
      }}
    />
  );
}
