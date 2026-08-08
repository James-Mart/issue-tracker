import type { ProjectLabel } from "@server/schemas";
import { useUpdateIssue } from "../api/mutations";
import { useIssuePatchAction } from "../hooks/use-issue-patch-action";
import {
  assignmentLabelsEqual,
  sanitizeAssignmentIds,
  type LabelAssignableIssue,
} from "../lib/project-labels";
import { AssignmentLabelsEditor } from "./assignment-labels-editor";

export function IssueAssignmentLabelsField({
  issue,
  catalog,
  embedded = false,
}: {
  issue: LabelAssignableIssue;
  catalog: ProjectLabel[];
  embedded?: boolean;
}) {
  const update = useUpdateIssue();
  const { error, saving, run } = useIssuePatchAction();
  const selected = sanitizeAssignmentIds(issue.labels, catalog);

  return (
    <AssignmentLabelsEditor
      catalog={catalog}
      selected={selected}
      disabled={saving}
      error={error}
      embedded={embedded}
      onChange={(next) => {
        const sanitized = sanitizeAssignmentIds(next, catalog);
        if (assignmentLabelsEqual(issue.labels, sanitized)) return;
        void run(async () => {
          await update.mutateAsync({
            id: issue.id,
            patch: { labels: sanitized },
          });
        });
      }}
    />
  );
}
