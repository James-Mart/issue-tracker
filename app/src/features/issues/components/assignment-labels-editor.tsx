import { FIELD_LABELS } from "@server/fields";
import type { ProjectLabel } from "@server/schemas";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils/cn";
import { toggleAssignmentId } from "../lib/project-labels";
import { ProjectLabelChip } from "./project-label-chip";

export function AssignmentLabelsEditor({
  catalog,
  selected,
  onChange,
  disabled,
  error,
  /** When true, omit card chrome and the Labels heading (parent MetaRow supplies it). */
  embedded = false,
}: {
  catalog: ProjectLabel[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  error?: string | null;
  embedded?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2",
        !embedded && "gap-3 rounded-md border p-3",
      )}
    >
      {embedded ? null : <Label>{FIELD_LABELS.labels}</Label>}
      {catalog.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No labels in project catalog.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {catalog.map((label) => {
            const checked = selected.includes(label.id);
            return (
              <li key={label.id}>
                <button
                  type="button"
                  disabled={disabled}
                  aria-pressed={checked}
                  aria-label={`${checked ? "Remove" : "Add"} label ${label.id}`}
                  title={label.description}
                  onClick={() =>
                    onChange(toggleAssignmentId(selected, label.id))
                  }
                  className={cn(
                    "rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    checked
                      ? "opacity-100 ring-1 ring-foreground/25"
                      : "opacity-45 hover:opacity-80",
                    disabled && "cursor-not-allowed opacity-40",
                  )}
                >
                  <ProjectLabelChip label={label} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
