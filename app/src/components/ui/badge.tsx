import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

/** Translucent status tints over panel — aliases share one hue. */
const tintCurrent =
  "border-transparent bg-primary/20 [color:hsl(var(--current))]";
const tintWarn =
  "border-warning/40 bg-warning/15 [color:hsl(var(--warning))]";
const tintBlocked =
  "border-transparent bg-destructive/20 [color:hsl(var(--blocked))]";
const tintDone =
  "border-transparent bg-success/20 [color:hsl(var(--success))]";
const tintTodo =
  "border-transparent bg-muted-foreground/20 text-muted-foreground";

const badgeVariantClasses = {
  current: tintCurrent,
  inProgress: tintCurrent,
  warn: tintWarn,
  blocked: tintBlocked,
  destructive: tintBlocked,
  done: tintDone,
  todo: tintTodo,
  outline: "text-foreground",
  secondary: "border-border bg-secondary text-secondary-foreground",
} as const;

export const BADGE_VARIANTS = Object.keys(
  badgeVariantClasses,
) as (keyof typeof badgeVariantClasses)[];

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: badgeVariantClasses,
    },
    defaultVariants: {
      variant: "secondary",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
