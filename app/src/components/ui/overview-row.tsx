import * as React from "react";
import { AlertCircle, AlertTriangle, MoreHorizontal } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsCoarsePointer } from "@/hooks/use-coarse-pointer";

export interface OverviewRowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Identity slot — pass an `Avatar` (or any node); the row does not import it. */
  avatar?: React.ReactNode;
  /** Row-level state disc (e.g. `StateIcon`). */
  stateIcon?: React.ReactNode;
  /** At-rest status chips (e.g. planning) — sit after the title, before the disc. */
  chips?: React.ReactNode;
  /** Tabular quantity (e.g. `3/4`). */
  count?: React.ReactNode;
  /** At-rest attention signal — warn-hued warning icon only (no chip). */
  attention?: boolean;
  /** At-rest blocked signal — blocked-hued exclamation icon only (no chip). */
  blocked?: boolean;
  /** Fine-pointer hover rail — icon buttons and chips overlaid on the right edge. */
  overlay?: React.ReactNode;
  /** Coarse-pointer overflow menu — flat labeled `DropdownMenuItem`s only. */
  touchMenu?: React.ReactNode;
  /**
   * When false, an ancestor must carry `group` so overlay reveal tracks the
   * whole row (e.g. Structure tree rows with an external chevron).
   */
  overlayGroup?: boolean;
  /** Stretched link target so the full card drills in; overlay/touch menu stay above. */
  drillInTo?: string;
  /** Accessible name for the stretched drill-in link. */
  drillInLabel?: string;
}

const overlayReveal =
  "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100 data-[state=open]:opacity-100";

/**
 * Dense overview row shell: avatar · title · chips · state icon · icon signals · count.
 * At rest, attention/blocked are hue-coded icons only; optional chips are for
 * phase (e.g. planning), not those signals.
 * Optional overlay fades in on hover/focus; touch uses a separate flat menu.
 */
export function OverviewRow({
  avatar,
  stateIcon,
  chips,
  count,
  attention = false,
  blocked = false,
  overlay,
  touchMenu,
  overlayGroup = true,
  drillInTo,
  drillInLabel,
  className,
  children,
  ...props
}: OverviewRowProps) {
  const isCoarsePointer = useIsCoarsePointer();
  const hasOverlayRail = overlay != null;
  const hasTouchMenu = touchMenu != null;
  const showTouchOverflow = isCoarsePointer && hasTouchMenu;

  return (
    <div
      className={cn(
        "relative flex items-center gap-3.5 rounded-lg border border-border bg-card px-3.5 py-[11px]",
        overlayGroup && (hasOverlayRail || showTouchOverflow) && "group",
        className,
      )}
      {...props}
    >
      {drillInTo != null ? (
        <Link
          to={drillInTo}
          aria-label={drillInLabel}
          className="absolute inset-0 z-0 rounded-lg"
        />
      ) : null}

      <div
        className={cn(
          "relative z-[1] flex min-w-0 flex-1 items-center gap-3.5",
          drillInTo != null && "pointer-events-none",
        )}
      >
        {avatar != null ? (
          <span className="inline-flex shrink-0">{avatar}</span>
        ) : null}
        <div className="min-w-0 flex-1 truncate font-medium text-foreground">
          {children}
        </div>
        {chips != null ? (
          <span className="inline-flex shrink-0">{chips}</span>
        ) : null}
        {stateIcon != null ? (
          <span className="inline-flex shrink-0">{stateIcon}</span>
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
          <span className="w-9 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
            {count}
          </span>
        ) : null}
      </div>

      {showTouchOverflow ? (
        <div className="absolute inset-y-0 right-0 z-[2] flex items-center bg-gradient-to-l from-card from-55% via-card/95 to-transparent pl-6 pr-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11 shrink-0"
                title="Row actions"
                onClick={(event) => event.stopPropagation()}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">{touchMenu}</DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : hasOverlayRail ? (
        <div
          className={cn(
            "pointer-events-none absolute inset-y-0 right-0 z-[2] flex items-center gap-2 bg-gradient-to-l from-card from-55% via-card/95 to-transparent pl-8 pr-1.5",
            overlayReveal,
          )}
        >
          <span className="pointer-events-auto flex items-center gap-2">
            {overlay}
          </span>
        </div>
      ) : null}
    </div>
  );
}
