import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/** Aligned label/value row for the detail metadata block. */
export function MetaRow({
  label,
  value,
  className,
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[9rem_minmax(0,1fr)] items-start gap-x-3 text-sm",
        className,
      )}
    >
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <div className="min-w-0 break-words text-foreground">{value}</div>
    </div>
  );
}
