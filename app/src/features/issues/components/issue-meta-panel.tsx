import type { ReactNode } from "react";
import { FIELD_LABELS } from "@server/fields";
import { kindHas, hasAssignee, hasAttention } from "@server/kind";
import type { IssueDetail } from "@server/schemas";
import {
  IssueAttentionReasonField,
  IssueNeedsAttentionField,
} from "./issue-attention-fields";
import { IssueAssigneeField } from "./issue-assignee-field";
import { IssueMergePolicyField } from "./issue-merge-policy-field";
import { IssuePartOfField } from "./issue-part-of-field";
import { IssueWorkspaceField } from "./issue-workspace-field";
import { MetaRow } from "./meta-row";

export function IssueMetaPanel({ issue }: { issue: IssueDetail }) {
  const rows: ReactNode[] = [];

  if (issue.kind === "project") {
    rows.push(
      <MetaRow
        key="workspace"
        label={FIELD_LABELS.workspace}
        value={<IssueWorkspaceField issue={issue} />}
      />,
      <MetaRow
        key="mergePolicy"
        label={FIELD_LABELS.mergePolicy}
        value={<IssueMergePolicyField issue={issue} />}
      />,
    );
  }

  if (
    kindHas(issue.kind, "detailPartOf") &&
    (issue.kind === "epic" || issue.kind === "story" || issue.kind === "task")
  ) {
    rows.push(
      <MetaRow
        key="partOf"
        label={FIELD_LABELS.partOf}
        value={<IssuePartOfField issue={issue} />}
      />,
    );
  }

  if (hasAssignee(issue)) {
    rows.push(
      <MetaRow
        key="assignee"
        label={FIELD_LABELS.assignee}
        value={<IssueAssigneeField issue={issue} />}
      />,
    );
  }

  if (hasAttention(issue)) {
    rows.push(
      <MetaRow
        key="needsAttention"
        label={FIELD_LABELS.needsAttention}
        value={<IssueNeedsAttentionField issue={issue} />}
      />,
    );
    if (issue.needsAttention) {
      rows.push(
        <MetaRow
          key="attentionReason"
          label={FIELD_LABELS.attentionReason}
          value={<IssueAttentionReasonField issue={issue} />}
        />,
      );
    }
  }

  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border bg-card p-4">
      {rows}
    </div>
  );
}
