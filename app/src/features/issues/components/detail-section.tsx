import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/** Mainline section eyebrow used on detail primary-column modules. */
export function DetailEyebrow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "font-display text-[11px] font-semibold uppercase tracking-[0.22em] text-[hsl(var(--current))]",
        className,
      )}
    >
      {children}
    </p>
  );
}
