import type { ReactNode } from "react";
import type { ProjectLabel } from "@server/schemas";
import { Button } from "@/components/ui/button";
import { sanitizeAssignmentIds } from "../lib/project-labels";
import { MetaFieldActions } from "./meta-row";
import { ProjectLabelChip } from "./project-label-chip";

const EMPTY_CATALOG_COPY =
  "No labels in the catalog. Add them in project settings, then assign them here.";

/** Overview labels value: assigned chips, Edit labels control, or empty-catalog copy. */
export function OverviewLabelsRow({
  catalog,
  assignmentIds,
  editTrigger,
}: {
  catalog: ProjectLabel[];
  assignmentIds: string[] | undefined;
  /** When set, replaces the default Edit labels button (e.g. dropdown trigger). */
  editTrigger?: ReactNode;
}) {
  if (catalog.length === 0) {
    return <p className="text-sm text-muted-foreground">{EMPTY_CATALOG_COPY}</p>;
  }

  const selected = new Set(sanitizeAssignmentIds(assignmentIds, catalog));
  const assigned = catalog.filter((label) => selected.has(label.id));

  return (
    <MetaFieldActions>
      {assigned.map((label) => (
        <ProjectLabelChip key={label.id} label={label} />
      ))}
      {editTrigger ?? (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto px-0 py-0 text-sm font-normal"
          aria-label="Edit labels"
        >
          Edit labels
        </Button>
      )}
    </MetaFieldActions>
  );
}
