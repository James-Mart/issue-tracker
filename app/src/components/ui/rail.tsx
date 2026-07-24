import * as React from "react";
import type { DerivedState, IssueRecord } from "@server/schemas";
import {
  statusStages,
  type StatusStage,
  type StatusStageState,
} from "@/features/issues/lib/derived";
import type { RailNodeState } from "@/features/issues/lib/rail-state";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils/cn";

export type { RailNodeState };

/** Current-hue live glow on a port — arbitrary property so Tailwind emits box-shadow, not a shadow color. */
const portGlow = "[box-shadow:var(--glow)]";

/** Edge into a node: solid = satisfied/landed hop; dashed = waiting on a dependency. */
export type RailEdge = "solid" | "dashed";

/** Port ring/fill per state — border color encodes state; the void base keeps ports hollow. */
const portStateClasses: Record<RailNodeState, string> = {
  ready: "border-[hsl(var(--ink))] bg-[hsl(var(--void))]",
  "in-flight": "border-[hsl(var(--current))] bg-[hsl(var(--current))]",
  blocked: "border-[hsl(var(--blocked))] bg-[hsl(var(--void))]",
  merged:
    "border-[hsl(var(--merged))] bg-[color-mix(in_srgb,hsl(var(--merged))_22%,hsl(var(--void)))]",
};

/** Label ink per state — in-flight lifts to current, blocked recedes to mut. */
const labelStateClasses: Record<RailNodeState, string> = {
  ready: "text-foreground",
  "in-flight": "text-[hsl(var(--current))]",
  blocked: "text-muted-foreground",
  merged: "text-foreground",
};

export interface RailPortProps {
  state: RailNodeState;
  label?: React.ReactNode;
  /** Force the current-hue glow; defaults to on for in-flight ports. */
  glow?: boolean;
  className?: string;
  portClassName?: string;
  labelClassName?: string;
}

/** State-encoded port disc + optional label — shared by RailNode and DependencyGraph. */
export function RailPort({
  state,
  label,
  glow,
  className,
  portClassName,
  labelClassName,
}: RailPortProps) {
  const showGlow = glow ?? state === "in-flight";

  return (
    <span className={cn(className)}>
      <span
        aria-hidden="true"
        className={cn(
          "h-3 w-3 shrink-0 rounded-full border-2",
          portStateClasses[state],
          showGlow && portGlow,
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

/**
 * Fraction (0–1) down the spine of the in-flight port — where the work-cursor
 * bead travels to and rests. `null` when no node is in-flight (no live target).
 * Assumes uniform node rhythm, so the port center of node `i` of `n` sits at
 * `(i + 0.5) / n`.
 */
export function workCursorFraction(
  states: readonly RailNodeState[],
): number | null {
  const index = states.indexOf("in-flight");
  if (index < 0) return null;
  return (index + 0.5) / states.length;
}

export interface RailProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Surface a work-cursor bead that travels the spine toward the in-flight node
   * — telemetry that autonomous work is on the line. Under `prefers-reduced-motion`
   * the bead does not travel; it rests statically on the in-flight port.
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
  const fraction = live ? workCursorFraction(states) : null;

  return (
    <div
      role="list"
      className={cn(
        "relative pl-[26px]",
        // the mainline spine: a 2px vertical gradient (rail-lit -> rail)
        "before:absolute before:left-[7px] before:bottom-2 before:top-2 before:w-[2px] before:rounded-[2px] before:bg-gradient-to-b before:from-[hsl(var(--rail-lit))] before:to-[hsl(var(--rail))] before:content-['']",
        className,
      )}
      {...props}
    >
      {fraction != null && (
        <span
          aria-hidden="true"
          data-testid="rail-work-cursor"
          style={{ "--wc-end": `${fraction * 100}%` } as React.CSSProperties}
          className={cn(
            "pointer-events-none absolute left-[3px] top-[var(--wc-end)] z-10 h-2.5 w-2.5 -translate-y-1/2 rounded-full",
            "bg-[hsl(var(--current))] [box-shadow:var(--glow)]",
            // motion is telemetry: travel only when motion is allowed; under
            // reduced-motion the base top (the in-flight port) is the rest state.
            "motion-safe:animate-work-cursor",
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
  /** Force the current-hue glow; defaults to on for in-flight ports. */
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
          className="pointer-events-none absolute left-[-18px] top-[-6px] h-[18px] border-l-2 border-dashed border-[hsl(var(--blocked))] opacity-[.55]"
        />
      )}
      <RailPort
        state={state}
        label={label}
        glow={glow}
        className="contents"
        portClassName="absolute left-[-23px] top-3"
      />
      {children}
    </div>
  );
}

const sparkDotClasses: Record<StatusStageState, string> = {
  idle: "border-[hsl(var(--rail-lit))] bg-[hsl(var(--void))]",
  done: "border-[hsl(var(--merged))] bg-[color-mix(in_srgb,hsl(var(--merged))_32%,hsl(var(--void)))]",
  current:
    "border-[hsl(var(--current))] bg-[hsl(var(--current))] [box-shadow:var(--glow)]",
};

const sparkSegClasses: Record<StatusStageState, string> = {
  idle: "bg-[hsl(var(--rail))]",
  done: "bg-[hsl(var(--merged))]",
  current:
    "bg-[linear-gradient(90deg,hsl(var(--merged)),hsl(var(--current)))]",
};

/** Segment state from the two dots it joins — single source for class + data-state. */
export function sparkSegState(
  prev: StatusStageState,
  next: StatusStageState,
): StatusStageState {
  if (next === "current") return "current";
  if (prev === "done" && next === "done") return "done";
  return "idle";
}

function progressRailAriaLabel(stages: readonly StatusStage[]): string {
  if (stages.every((s) => s.state === "done")) {
    return `Pipeline: ${stages.map((s) => s.label).join(", ")} complete`;
  }
  const done = stages.filter((s) => s.state === "done").map((s) => s.label);
  const current = stages.find((s) => s.state === "current");
  const remaining = stages
    .filter((s) => s.state === "idle")
    .map((s) => s.label);
  const parts: string[] = [];
  if (done.length > 0) parts.push(`${done.join(" and ")} done`);
  if (current) parts.push(`${current.label} now`);
  if (remaining.length > 0) parts.push(`${remaining.join(" and ")} remaining`);
  return `Pipeline: ${parts.join(", ")}`;
}

export interface ProgressRailProps
  extends React.HTMLAttributes<HTMLDivElement> {
  issue: IssueRecord;
  state?: DerivedState;
}

/**
 * Inline lifecycle sparkline — one dot per primary status stage.
 * Returns null when the issue kind has no stage sequence.
 */
export function ProgressRail({
  issue,
  state,
  className,
  ...props
}: ProgressRailProps) {
  const stages = statusStages(issue, state);
  if (stages.length === 0) return null;

  return (
    <div
      role="group"
      aria-label={progressRailAriaLabel(stages)}
      className={cn("inline-flex items-center", className)}
      {...props}
    >
      {stages.map((stage, i) => {
        const segState =
          i > 0
            ? sparkSegState(stages[i - 1]!.state, stages[i]!.state)
            : null;
        return (
          <React.Fragment key={stage.label}>
            {segState != null && (
              <span
                aria-hidden="true"
                data-testid="progress-rail-seg"
                data-state={segState}
                className={cn(
                  "h-0.5 w-[26px] shrink-0",
                  sparkSegClasses[segState],
                )}
              />
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={stage.label}
                  data-testid="progress-rail-dot"
                  data-state={stage.state}
                  className={cn(
                    "inline-block h-2.5 w-2.5 shrink-0 appearance-none rounded-full border-2 p-0",
                    sparkDotClasses[stage.state],
                  )}
                />
              </TooltipTrigger>
              <TooltipContent>{stage.label}</TooltipContent>
            </Tooltip>
          </React.Fragment>
        );
      })}
    </div>
  );
}
