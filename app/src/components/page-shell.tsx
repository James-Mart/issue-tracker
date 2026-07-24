import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/** Shared centered page chrome for route-level shells (detail, overview, cockpit). */
export const PAGE_SHELL_CLASS =
  "mx-auto flex min-h-svh w-full max-w-3xl flex-col gap-4 px-6 py-8";

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
