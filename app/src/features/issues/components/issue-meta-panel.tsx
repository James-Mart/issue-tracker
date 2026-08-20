import type { ReactNode } from "react";
import { FIELD_LABELS } from "@server/fields";
import { kindHas, hasAssignee, hasAttention } from "@server/kind";
import type { IssueDetail, ProjectLabel } from "@server/schemas";
import { isLabelAssignableIssue } from "../lib/project-labels";
import {
  IssueAttentionReasonField,
  IssueNeedsAttentionField,
} from "./issue-attention-fields";
import { IssueAssigneeField } from "./issue-assignee-field";
import { IssueAssignmentLabelsField } from "./issue-assignment-labels-field";
import { IssuePartOfField } from "./issue-part-of-field";
import { IssueSourceIdeaField } from "./issue-source-idea-field";
import { IssueStakeholderField } from "./issue-stakeholder-field";
import { CompactMetaBlock } from "./compact-meta";
import { GitStackPanel } from "./git-stack-panel";
import { MetaRow } from "./meta-row";

/**
 * One compact, aligned metadata block for detail overview: plan scalars,
 * labels, and git/spec scalars — not a stack of separate cards.
 */
export function IssueMetaPanel({
  issue,
  catalog = [],
}: {
  issue: IssueDetail;
  catalog?: ProjectLabel[];
}) {
  const rows: ReactNode[] = [];

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

  if (issue.kind === "epic" || issue.kind === "story") {
    rows.push(<IssueSourceIdeaField key="sourceIdea" issue={issue} />);
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

  if (isLabelAssignableIssue(issue)) {
    rows.push(
      <MetaRow
        key="labels"
        label={FIELD_LABELS.labels}
        value={
          <IssueAssignmentLabelsField
            issue={issue}
            catalog={catalog}
            embedded
          />
        }
      />,
    );
  }

  if (issue.kind === "idea") {
    rows.push(
      <MetaRow
        key="stakeholder"
        label={FIELD_LABELS.stakeholder}
        value={<IssueStakeholderField issue={issue} />}
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

  if (issue.kind === "story" || issue.kind === "task") {
    rows.push(<GitStackPanel key="git-scalars" issue={issue} />);
  }

  if (rows.length === 0) return null;

  return <CompactMetaBlock>{rows}</CompactMetaBlock>;
}
