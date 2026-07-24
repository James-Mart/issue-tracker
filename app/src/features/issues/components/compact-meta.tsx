import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/** One label/value pair in the compact meta block. */
export function CompactMetaItem({
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
        "flex min-w-0 max-w-full items-baseline gap-1.5 text-sm",
        className,
      )}
    >
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-foreground">{value}</span>
    </div>
  );
}

/** Dense Mainline wrap of present meta scalars (above the Rail / stack body). */
export function CompactMetaBlock({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-region="meta-scalars"
      className={cn(
        "flex flex-wrap gap-x-5 gap-y-1.5 rounded-lg border border-border bg-card px-3.5 py-2.5",
        className,
      )}
    >
      {children}
    </div>
  );
}
