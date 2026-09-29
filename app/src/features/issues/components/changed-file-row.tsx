import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils/cn";

export function changedFileRowClass(selected: boolean): string {
  return cn(
    "rounded-md border px-2 py-1.5 text-left font-mono text-[12px] leading-snug",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    selected
      ? "border-primary bg-[color-mix(in_srgb,hsl(var(--current))_12%,hsl(var(--panel)))]"
      : "border-border bg-card hover:border-[hsl(var(--rail-lit))]",
  );
}

export function DiffLineCounts({
  additions,
  deletions,
  className,
  ...rest
}: {
  additions: number;
  deletions: number;
  className?: string;
} & ComponentPropsWithoutRef<"span">) {
  return (
    <span className={cn("tabular-nums", className)} {...rest}>
      <span className="text-success">+{additions}</span>{" "}
      <span className="text-destructive">-{deletions}</span>
    </span>
  );
}
