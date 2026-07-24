import type { IssueDetail } from "@server/schemas";
import { useUpdateIssue } from "../api/mutations";
import { InlineField } from "./inline-field";
import { IssueNavigateButton } from "./issue-navigate-button";

export function IssueStackedOnField({
  issue,
}: {
  issue: Extract<IssueDetail, { kind: "story" }>;
}) {
  const update = useUpdateIssue();

  return (
    <InlineField
      value={issue.stackedOn ?? ""}
      issue={issue}
      emptyLabel="(root)"
      placeholder="story id"
      displayClassName="font-mono"
      inputClassName="font-mono"
      trailingDisplay={
        issue.stackedOn ? <IssueNavigateButton id={issue.stackedOn} /> : null
      }
      onSave={async (next) => {
        const trimmed = next.trim();
        const current = issue.stackedOn ?? "";
        if (trimmed === current) return;
        await update.mutateAsync({
          id: issue.id,
          patch: { stackedOn: trimmed === "" ? null : trimmed },
        });
      }}
    />
  );
}
