import type { IssueDetail } from "@server/schemas";
import { useUpdateIssue } from "../api/mutations";
import { InlineField } from "./inline-field";

export function IssueTitleField({ issue }: { issue: IssueDetail }) {
  const update = useUpdateIssue();

  return (
    <InlineField
      value={issue.title}
      issue={issue}
      displayClassName="break-words text-xl font-semibold tracking-tight text-foreground"
      inputClassName="h-auto py-1 text-xl font-semibold tracking-tight"
      validate={(next) => (next.trim() ? null : "Title cannot be empty")}
      onSave={async (next) => {
        const trimmed = next.trim();
        if (trimmed === issue.title) return;
        await update.mutateAsync({ id: issue.id, patch: { title: trimmed } });
      }}
      renderDisplay={(display) => <h1 className="min-w-0">{display}</h1>}
    />
  );
}
