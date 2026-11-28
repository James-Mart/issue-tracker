import { useCallback, useState } from "react";
import type { IssueDetail } from "@server/schemas";
import { OutlineBodyCard } from "./outline-body-card";
import { OutlineLinkedWorkCard } from "./outline-linked-work-card";
import {
  OutlinePendingDraftCard,
  type OutlineWithDraft,
} from "./outline-pending-draft-card";

/**
 * Outline overview cards. Editing the body holds linked-work placement
 * until Save or Cancel.
 */
export function OutlineOverview({
  issue,
}: {
  issue: Extract<IssueDetail, { kind: "outline" }>;
}) {
  // This overview stays mounted when the reader opens another outline.
  // The id drops the previous outline's edit hold before its card unmounts.
  const [editingFor, setEditingFor] = useState<string | null>(null);
  const onEditingChange = useCallback(
    (editing: boolean) => {
      setEditingFor(editing ? issue.id : null);
    },
    [issue.id],
  );
  return (
    <>
      <OutlineLinkedWorkCard
        key={`${issue.id}-linked`}
        issue={issue}
        bodyEditing={editingFor === issue.id}
      />
      {issue.pendingDraft !== undefined ? (
        <OutlinePendingDraftCard
          key={`${issue.id}-draft`}
          issue={issue as OutlineWithDraft}
        />
      ) : null}
      <OutlineBodyCard
        key={issue.id}
        issue={issue}
        onEditingChange={onEditingChange}
      />
    </>
  );
}
