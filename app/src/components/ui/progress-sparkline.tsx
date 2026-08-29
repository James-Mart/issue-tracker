import { cn } from "@/lib/utils/cn";

export type SparklineTone = "idle" | "current" | "done";

export type SparklineStage = {
  name: string;
  tone: SparklineTone;
};

const dotTone: Record<SparklineTone, string> = {
  idle: "border-[hsl(var(--rail-lit))] bg-[hsl(var(--void))]",
  current:
    "border-[hsl(var(--current))] bg-[hsl(var(--current))] [box-shadow:var(--glow)]",
  done: "border-[hsl(var(--merged))] bg-[color-mix(in_srgb,hsl(var(--merged))_32%,hsl(var(--void)))]",
};

function segClass(from: SparklineTone, to: SparklineTone): string {
  if (from === "done" && to === "current") {
    return "bg-gradient-to-r from-[hsl(var(--merged))] to-[hsl(var(--current))]";
  }
  if (from === "done" && to === "done") {
    return "bg-[hsl(var(--merged))]";
  }
  return "bg-[hsl(var(--rail))]";
}

function sparklineLabel(stages: readonly SparklineStage[]): string {
  const current = stages.find((stage) => stage.tone === "current");
  if (current) return `Progress: ${current.name}`;
  if (stages.length > 0 && stages.every((stage) => stage.tone === "done")) {
    return `Progress: ${stages[stages.length - 1]!.name}`;
  }
  return "Progress";
}

/**
 * Word-sized lifecycle rail. Stage names sit in an overlay on hover/focus so
 * the parent row stays one line.
 */
export function ProgressSparkline({
  stages,
  className,
}: {
  stages: readonly SparklineStage[];
  className?: string;
}) {
  if (stages.length === 0) return null;

  return (
    <span
      role="img"
      aria-label={sparklineLabel(stages)}
      data-testid="progress-sparkline"
      className={cn("inline-flex items-center", className)}
    >
      {stages.map((stage, index) => (
        <span key={`${stage.name}:${index}`} className="inline-flex items-center">
          {index > 0 ? (
            <span
              aria-hidden="true"
              data-testid="sparkline-seg"
              className={cn(
                "h-0.5 w-[26px] shrink-0",
                segClass(stages[index - 1]!.tone, stage.tone),
              )}
            />
          ) : null}
          <span
            tabIndex={0}
            title={stage.name}
            data-testid="sparkline-dot"
            data-stage={stage.name}
            data-tone={stage.tone}
            className="group/dot relative inline-flex shrink-0"
          >
            <span
              aria-hidden="true"
              className={cn(
                "h-2.5 w-2.5 rounded-full border-2",
                dotTone[stage.tone],
              )}
            />
            <span
              role="tooltip"
              className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-0.5 font-mono text-[10px] text-popover-foreground group-hover/dot:block group-focus-visible/dot:block"
            >
              {stage.name}
            </span>
          </span>
        </span>
      ))}
    </span>
  );
}
