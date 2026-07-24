import type { IssueDetail } from "@server/schemas";
import { useUpdateIssue } from "../api/mutations";
import { needsAttentionPatch } from "../lib/needs-attention-patch";
import { InlineField } from "./inline-field";
import { IssueBooleanPatchField } from "./issue-boolean-patch-field";

export function IssueNeedsAttentionField({
  issue,
}: {
  issue: Extract<IssueDetail, { kind: "epic" | "story" | "task" }>;
}) {
  return (
    <IssueBooleanPatchField
      issueId={issue.id}
      checked={issue.needsAttention}
      labels={{ on: "on", off: "off" }}
      patchFor={needsAttentionPatch}
    />
  );
}

export function IssueAttentionReasonField({
  issue,
}: {
  issue: Extract<IssueDetail, { kind: "epic" | "story" | "task" }>;
}) {
  const update = useUpdateIssue();

  return (
    <InlineField
      value={issue.attentionReason ?? ""}
      issue={issue}
      emptyLabel="no reason"
      onSave={async (next) => {
        const trimmed = next.trim();
        const current = issue.attentionReason ?? "";
        if (trimmed === current) return;
        await update.mutateAsync({
          id: issue.id,
          patch: { attentionReason: trimmed === "" ? null : trimmed },
        });
      }}
    />
  );
}
