import type { ReactNode } from "react";
import type { ProjectLabel } from "@server/schemas";
import { MetaFieldActions } from "./meta-row";
import { ProjectLabelChip } from "./project-label-chip";

const LABELS_NONE = (
  <span className="text-sm text-muted-foreground">None</span>
);

/**
 * Overview labels value: assigned chips or a neutral “None”, plus optional
 * `editTrigger` when the Project has at least one catalog label (picker is hidden
 * when there is nothing to assign—see Epic contract: hidden, not disabled).
 */
export function OverviewLabelsRow({
  catalog,
  assigned,
  editTrigger,
}: {
  catalog: ProjectLabel[];
  /** Resolved against `catalog` in the parent (`resolveAssignedLabels`). */
  assigned: ProjectLabel[];
  /** Opens the label editor (e.g. checklist in a dropdown); shown only when `catalog` is non-empty. */
  editTrigger?: ReactNode;
}) {
  const showCatalog = catalog.length > 0;

  // With no catalog entries, the issue detail surface offers no label picker; "None" is the whole empty state.
  const value =
    showCatalog && assigned.length > 0 ? (
      assigned.map((label) => <ProjectLabelChip key={label.id} label={label} />)
    ) : (
      LABELS_NONE
    );

  return (
    <MetaFieldActions>
      {value}
      {showCatalog ? editTrigger : null}
    </MetaFieldActions>
  );
}
