import * as React from "react";
import { AlertCircle, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface OverviewRowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Identity slot — pass an `Avatar` (or any node); the row does not import it. */
  avatar?: React.ReactNode;
  /** Lifecycle sparkline slot (e.g. `ProgressRail`). */
  sparkline?: React.ReactNode;
  /** Tabular quantity (e.g. `3/4`). */
  count?: React.ReactNode;
  /** At-rest attention signal — warn-hued warning icon only (no chip). */
  attention?: boolean;
  /** At-rest blocked signal — blocked-hued exclamation icon only (no chip). */
  blocked?: boolean;
}

/**
 * Dense overview row shell: avatar · title · sparkline · icon signals · count.
 * At rest, attention/blocked are hue-coded icons only — never chips.
 */
export function OverviewRow({
  avatar,
  sparkline,
  count,
  attention = false,
  blocked = false,
  className,
  children,
  ...props
}: OverviewRowProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3.5 rounded-lg border border-border bg-card px-3.5 py-[11px]",
        className,
      )}
      {...props}
    >
      {avatar != null ? (
        <span className="inline-flex shrink-0">{avatar}</span>
      ) : null}
      <div className="min-w-0 flex-1 truncate font-medium text-foreground">
        {children}
      </div>
      {sparkline != null ? (
        <span className="inline-flex shrink-0">{sparkline}</span>
      ) : null}
      {attention ? (
        <AlertTriangle
          aria-label="needs attention"
          className="h-3.5 w-3.5 shrink-0 [color:hsl(var(--warning))]"
        />
      ) : null}
      {blocked ? (
        <AlertCircle
          aria-label="blocked"
          className="h-3.5 w-3.5 shrink-0 [color:hsl(var(--blocked))]"
        />
      ) : null}
      {count != null ? (
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
          {count}
        </span>
      ) : null}
    </div>
  );
}
