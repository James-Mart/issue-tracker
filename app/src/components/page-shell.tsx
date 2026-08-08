import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/** Shared page chrome for route-level shells (detail, overview, cockpit). */
export const PAGE_SHELL_CLASS =
  "flex min-h-svh w-full min-w-0 flex-col gap-4 px-6 py-8";

/**
 * Comfortable reading measure for long prose and form bodies only
 * (~68–76ch). Do not apply to lists, overviews, or dense metadata.
 */
export const READING_MEASURE_CLASS = "max-w-[72ch]";

export function PageShell({
  className,
  children,
  ...rootProps
}: {
  className?: string;
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn(PAGE_SHELL_CLASS, className)} {...rootProps}>
      {children}
    </div>
  );
}
