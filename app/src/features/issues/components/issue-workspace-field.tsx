import type { IssueDetail } from "@server/schemas";
import { useUpdateIssue } from "../api/mutations";
import { InlineField } from "./inline-field";

export function IssueWorkspaceField({
  issue,
}: {
  issue: Extract<IssueDetail, { kind: "project" }>;
}) {
  const update = useUpdateIssue();

  return (
    <InlineField
      value={issue.workspace ?? ""}
      issue={issue}
      emptyLabel="not set"
      displayClassName="font-mono"
      inputClassName="font-mono"
      onSave={async (next) => {
        const trimmed = next.trim();
        const current = issue.workspace ?? "";
        if (trimmed === current) return;
        await update.mutateAsync({
          id: issue.id,
          patch: { workspace: trimmed === "" ? null : trimmed },
        });
      }}
    />
  );
}
