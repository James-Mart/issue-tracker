import * as React from "react";
import { cn } from "@/lib/utils/cn";

/** Loading placeholder on a muted panel step — no elevation beyond the fill. */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-muted shadow-none",
        className,
      )}
      {...props}
    />
  );
}
