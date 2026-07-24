import type { IssueRecord, ProjectLabel } from "@server/schemas";
import { cn } from "@/lib/utils/cn";
import {
  isLabelAssignableIssue,
  resolveAssignedLabels,
} from "../lib/project-labels";
import { ProjectLabelChip } from "./project-label-chip";

export function ProjectLabelChips({
  issue,
  catalog,
  className,
}: {
  issue: IssueRecord;
  catalog: ProjectLabel[] | undefined;
  className?: string;
}) {
  if (!isLabelAssignableIssue(issue)) return null;
  const labels = resolveAssignedLabels(issue.labels, catalog);
  if (labels.length === 0) return null;
  return (
    <span className={cn("flex flex-wrap items-center gap-1", className)}>
      {labels.map((label) => (
        <ProjectLabelChip key={label.id} label={label} />
      ))}
    </span>
  );
}
