import type { ProjectLabel } from "@server/schemas";
import { type LabelAssignableIssue } from "../lib/project-labels";
import { OverviewLabelsRow } from "./overview-labels-row";

export function IssueAssignmentLabelsField({
  issue,
  catalog,
}: {
  issue: LabelAssignableIssue;
  catalog: ProjectLabel[];
}) {
  return (
    <OverviewLabelsRow catalog={catalog} assignmentIds={issue.labels} />
  );
}
