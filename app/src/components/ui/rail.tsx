import * as React from "react";
import type { RailNodeState } from "@/features/issues/lib/rail-state";
import { cn } from "@/lib/utils/cn";

export type { RailNodeState };

/**
 * Live in-flight emphasis: `--glow` plus the livedot pulse. Arbitrary box-shadow
 * so Tailwind emits the property, not a shadow color. Pulse respects reduced-motion.
 */
const portLive =
  "[box-shadow:var(--glow)] motion-safe:animate-live-dot";

/** Edge into a node: solid = satisfied/landed hop; dashed = waiting on a dependency. */
export type RailEdge = "solid" | "dashed";

/**
 * Single state→appearance map for RailPort and StateIcon.
 * ready = hollow ink; in-flight = filled current + glow/pulse; merged = filled
 * merged (dim); blocked = blocked outline; needs-attention = warn outline.
 */
const portStateClasses: Record<RailNodeState, string> = {
  ready: "border-[hsl(var(--ink))] bg-[hsl(var(--void))]",
  "in-flight": "border-[hsl(var(--current))] bg-[hsl(var(--current))]",
  blocked: "border-[hsl(var(--blocked))] bg-[hsl(var(--void))]",
  merged:
    "border-[hsl(var(--merged))] bg-[color-mix(in_srgb,hsl(var(--merged))_22%,hsl(var(--void)))]",
  "needs-attention": "border-[hsl(var(--warn))] bg-[hsl(var(--void))]",
};

/** Label ink per state — in-flight lifts to current, blocked/attention recede to mut. */
const labelStateClasses: Record<RailNodeState, string> = {
  ready: "text-foreground",
  "in-flight": "text-[hsl(var(--current))]",
  blocked: "text-muted-foreground",
  merged: "text-foreground",
  "needs-attention": "text-[hsl(var(--warn))]",
};

/** Accessible name for the label-free StateIcon (color+shape carry the state visually). */
const stateIconLabel: Record<RailNodeState, string> = {
  ready: "ready",
  "in-flight": "in flight",
  blocked: "blocked",
  merged: "done",
  "needs-attention": "needs attention",
};

export interface RailPortProps {
  state: RailNodeState;
  label?: React.ReactNode;
  /** When true, apply the current-hue live glow/pulse. */
  glow?: boolean;
  className?: string;
  portClassName?: string;
  labelClassName?: string;
}

/** State-encoded port disc + optional label. */
export function RailPort({
  state,
  label,
  glow,
  className,
  portClassName,
  labelClassName,
}: RailPortProps) {
  const showLive = glow === true;

  return (
    <span className={cn(className)}>
      <span
        aria-hidden="true"
        data-testid="rail-port"
        data-state={state}
        className={cn(
          "h-3 w-3 shrink-0 rounded-full border-2",
          portStateClasses[state],
          showLive && portLive,
          portClassName,
        )}
      />
      {label != null && (
        <span
          className={cn(
            "font-medium",
            labelStateClasses[state],
            labelClassName,
          )}
        >
          {label}
        </span>
      )}
    </span>
  );
}

export interface StateIconProps {
  state: RailNodeState;
  /** When true, apply the live glow/pulse reserved for active in-flight work. */
  live?: boolean;
  className?: string;
}

/**
 * Row-level state disc — same appearance map as RailPort, never a text label.
 * Glow/pulse is opt-in via `live`; lifecycle in-flight fill does not imply it.
 */
export function StateIcon({ state, live, className }: StateIconProps) {
  return (
    <span
      role="img"
      aria-label={stateIconLabel[state]}
      data-testid="state-icon"
      data-state={state}
      data-live={live ? "true" : "false"}
      className={cn("inline-flex shrink-0", className)}
    >
      <RailPort state={state} glow={live} className="contents" />
    </span>
  );
}

/**
 * Index of the port the work-cursor sits on — the first in-flight node. `null`
 * when no node is in-flight, so there is no cursor on the spine.
 */
export function inFlightIndex(
  states: readonly RailNodeState[],
): number | null {
  const index = states.indexOf("in-flight");
  return index < 0 ? null : index;
}

/** Node rows in spine order — the work-cursor is a sibling, not a row. */
function portRows(rail: HTMLElement): HTMLElement[] {
  return Array.from(rail.children).filter(
    (child): child is HTMLElement => child.getAttribute("role") === "listitem",
  );
}

/**
 * Vertical center (px from the rail's top) of the port at `index`, taken from
 * the node row itself so a wrapped or taller row carries its port — and the
 * work-cursor — with it.
 */
function portCenter(rail: HTMLElement, index: number): number {
  const row = portRows(rail)[index].getBoundingClientRect();
  return row.top - rail.getBoundingClientRect().top + row.height / 2;
}

/** Work-cursor travel time; keep in step with the `duration-700` class below. */
const WORK_CURSOR_TRAVEL_MS = 700;

export interface RailProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Surface a work-cursor bead on the in-flight port — telemetry that work is on
   * the line. It shows only while traveling from the port it was resting on to a
   * new one; at rest, and under `prefers-reduced-motion`, the fixed port carries
   * the position on its own.
   */
  live?: boolean;
}

/** Single-spine lifecycle Rail: an ordered dependency spine of state-encoded ports. */
export function Rail({ className, children, live, ...props }: RailProps) {
  const states = React.Children.toArray(children).flatMap((child) =>
    React.isValidElement(child) &&
    (child.props as Partial<RailNodeProps>).state != null
      ? [(child.props as RailNodeProps).state]
      : [],
  );
  const target = live ? inFlightIndex(states) : null;
  const railRef = React.useRef<HTMLDivElement>(null);
  const [center, setCenter] = React.useState<number | null>(null);
  const [traveling, setTraveling] = React.useState(false);
  const restingAt = React.useRef<number | null>(null);

  React.useLayoutEffect(() => {
    if (target == null) {
      setCenter(null);
      return;
    }
    const rail = railRef.current;
    if (!rail) return;
    const measure = () => setCenter(portCenter(rail, target));
    measure();
    // Row height is content-driven (labels wrap), so the port center moves.
    const observer = new ResizeObserver(measure);
    observer.observe(rail);
    return () => observer.disconnect();
  }, [target]);

  React.useLayoutEffect(() => {
    const from = restingAt.current;
    restingAt.current = target;
    // Only a hop between two ports is travel. On first paint, and whenever work
    // joins or leaves the spine, the cursor is already at rest — so it stays
    // hidden instead of entering from the top of the rail.
    if (from == null || target == null || from === target) {
      setTraveling(false);
      return;
    }
    setTraveling(true);
    const timer = window.setTimeout(
      () => setTraveling(false),
      WORK_CURSOR_TRAVEL_MS,
    );
    return () => window.clearTimeout(timer);
  }, [target]);

  return (
    <div
      ref={railRef}
      role="list"
      className={cn(
        "relative pl-[26px]",
        // Spine (2px at left-7), ports (12px at -24 from each node), and the
        // work-cursor bead (10px at left-3) share horizontal center at 8px.
        // the mainline spine: a 2px vertical gradient (rail-lit -> rail)
        "before:absolute before:left-[7px] before:bottom-2 before:top-2 before:w-[2px] before:rounded-[2px] before:bg-gradient-to-b before:from-[hsl(var(--rail-lit))] before:to-[hsl(var(--rail))] before:content-['']",
        className,
      )}
      {...props}
    >
      {center != null && (
        <span
          aria-hidden="true"
          data-testid="rail-work-cursor"
          data-traveling={traveling ? "true" : "false"}
          style={{ top: center }}
          className={cn(
            "pointer-events-none absolute left-[3px] z-10 h-2.5 w-2.5 -translate-y-1/2 rounded-full",
            "bg-[hsl(var(--current))] [box-shadow:var(--glow)]",
            // Motion is telemetry: the cursor is ink only while the current moves
            // between ports, and never when motion is not allowed.
            "opacity-0 motion-safe:data-[traveling=true]:opacity-100",
            "motion-safe:transition-[top] motion-safe:duration-700 motion-safe:ease-work-cursor",
          )}
        />
      )}
      {children}
    </div>
  );
}

export interface RailNodeProps extends React.HTMLAttributes<HTMLDivElement> {
  state: RailNodeState;
  edge: RailEdge;
  label?: React.ReactNode;
  /** When true, apply the current-hue live glow/pulse. */
  glow?: boolean;
}

/** A node on the Rail: a state-encoded port, the edge that feeds it, and its label. */
export function RailNode({
  state,
  edge,
  label,
  glow,
  className,
  children,
  ...props
}: RailNodeProps) {
  return (
    <div
      role="listitem"
      className={cn("relative flex items-baseline gap-3 py-[9px]", className)}
      {...props}
    >
      {edge === "dashed" && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-1/2 left-[-18px] top-[-6px] border-l-2 border-dashed border-[hsl(var(--blocked))] opacity-[.55]"
        />
      )}
      <RailPort
        state={state}
        label={label}
        glow={glow ?? state === "in-flight"}
        className="contents"
        portClassName="absolute left-[-24px] top-1/2 -translate-y-1/2"
      />
      {children}
    </div>
  );
}
