import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/** Shared page chrome for route-level shells (detail, overview, cockpit). */
export const PAGE_SHELL_CLASS =
  "flex min-h-svh w-full min-w-0 flex-col gap-4 px-6 py-8";

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
