import type { IssueDetail } from "@server/schemas";
import { useUpdateIssue } from "../api/mutations";
import { InlineField } from "./inline-field";

export const SETUP_COMMAND_EMPTY_LABEL = "Add a command for new checkouts";
export const SETUP_COMMAND_CAPTION = "Non-zero exit blocks the checkout.";

export function IssueSetupCommandField({
  issue,
}: {
  issue: Extract<IssueDetail, { kind: "project" }>;
}) {
  const update = useUpdateIssue();
  const stored = issue.setupCommand ?? "";

  return (
    <div className="flex flex-col gap-0.5">
      <InlineField
        value={stored}
        issue={issue}
        emptyLabel={SETUP_COMMAND_EMPTY_LABEL}
        displayClassName={stored.trim() ? "font-mono" : undefined}
        inputClassName="font-mono"
        onSave={async (next) => {
          const trimmed = next.trim();
          const current = issue.setupCommand ?? "";
          if (trimmed === current) return;
          await update.mutateAsync({
            id: issue.id,
            patch: { setupCommand: trimmed === "" ? null : trimmed },
          });
        }}
      />
      <p className="text-xs text-muted-foreground">{SETUP_COMMAND_CAPTION}</p>
    </div>
  );
}
