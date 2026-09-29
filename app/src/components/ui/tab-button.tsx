import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils/cn";

export type TabTone = "current" | "warning";

export function TabButton({
  selected,
  tone = "current",
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<"button"> & {
  selected: boolean;
  tone?: TabTone;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className={cn(
        "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors",
        tone === "warning"
          ? selected
            ? "border-[hsl(var(--warning))] [color:hsl(var(--warning))]"
            : "border-transparent [color:hsl(var(--warning))] hover:[color:hsl(var(--warning))]"
          : selected
            ? "border-[hsl(var(--current))] text-[hsl(var(--current))]"
            : "border-transparent text-muted-foreground hover:text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
