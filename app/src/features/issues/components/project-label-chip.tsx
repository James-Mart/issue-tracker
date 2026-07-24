import type { ProjectLabel } from "@server/schemas";
import { cn } from "@/lib/utils/cn";
import { labelChipTextColor } from "../lib/project-labels";

export function ProjectLabelChip({
  label,
  className,
}: {
  label: ProjectLabel;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border border-black/10 px-2 py-0.5 font-mono text-xs font-medium",
        className,
      )}
      style={{
        backgroundColor: label.color,
        color: labelChipTextColor(label.color),
      }}
      title={label.description}
    >
      {label.id}
    </span>
  );
}
