import { cn } from "@/lib/utils/cn";
import type { DiffLayout } from "../lib/diff-layout-preference";

const OPTIONS: { value: DiffLayout; label: string }[] = [
  { value: "unified", label: "Unified" },
  { value: "split", label: "Split" },
];

export function DiffLayoutToggle({
  layout,
  onLayoutChange,
}: {
  layout: DiffLayout;
  onLayoutChange: (layout: DiffLayout) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Diff layout"
      data-testid="diff-layout-toggle"
      className="inline-flex shrink-0 rounded-md border border-border bg-[hsl(var(--panel))] p-0.5"
    >
      {OPTIONS.map((option) => {
        const selected = layout === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            data-layout={option.value}
            onClick={() => onLayoutChange(option.value)}
            className={cn(
              "rounded px-2.5 py-1 font-mono text-[11px] font-medium uppercase tracking-[0.08em] transition-colors",
              selected
                ? "bg-[hsl(var(--panel-2))] text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
