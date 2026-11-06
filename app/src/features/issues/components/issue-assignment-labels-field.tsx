import type { ProjectLabel } from "@server/schemas";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUpdateIssue } from "../api/mutations";
import { useIssuePatchAction } from "../hooks/use-issue-patch-action";
import {
  assignmentLabelsEqual,
  resolveAssignedLabels,
  sanitizeAssignmentIds,
  toggleAssignmentId,
  type LabelAssignableIssue,
} from "../lib/project-labels";
import { OverviewLabelsRow } from "./overview-labels-row";
import { ProjectLabelChip } from "./project-label-chip";

export function IssueAssignmentLabelsField({
  issue,
  catalog,
}: {
  issue: LabelAssignableIssue;
  catalog: ProjectLabel[];
}) {
  const update = useUpdateIssue();
  const { error, saving, run } = useIssuePatchAction();
  const assignedLabels = resolveAssignedLabels(issue.labels, catalog);
  const selected = assignedLabels.map((label) => label.id);

  const onChange = (next: string[]) => {
    const sanitized = sanitizeAssignmentIds(next, catalog);
    if (assignmentLabelsEqual(issue.labels, sanitized)) return;
    void run(async () => {
      await update.mutateAsync({
        id: issue.id,
        patch: { labels: sanitized },
      });
    });
  };

  const editTrigger =
    catalog.length === 0 ? null : (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground"
            aria-label="Edit labels"
            disabled={saving}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {catalog.map((label) => (
            <DropdownMenuCheckboxItem
              key={label.id}
              checked={selected.includes(label.id)}
              title={label.description}
              disabled={saving}
              onCheckedChange={() =>
                onChange(toggleAssignmentId(selected, label.id))
              }
              onSelect={(event) => event.preventDefault()}
            >
              <ProjectLabelChip label={label} />
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <OverviewLabelsRow
        catalog={catalog}
        assigned={assignedLabels}
        editTrigger={editTrigger}
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
