import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

const tabCountPillClass =
  "inline-flex min-w-[1.1rem] shrink-0 items-center justify-center rounded-full bg-muted px-1.5 py-0 font-mono text-[10px] font-semibold tabular-nums leading-none text-muted-foreground";

/** Numeric badge beside a tab label (issue detail tabs, review workbench, …). */
export function TabCountPill({
  className,
  children,
  ...props
}: { children: ReactNode } & ComponentPropsWithoutRef<"span">) {
  return (
    <span className={cn(tabCountPillClass, className)} {...props}>
      {children}
    </span>
  );
}
