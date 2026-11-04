import { forwardRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

export const GateToggleButton = forwardRef<
  HTMLButtonElement,
  {
    id: string;
    label: string;
    enabled: boolean;
    onToggle: () => void;
    disabled?: boolean;
    testId: string;
  }
>(function GateToggleButton(
  { id, label, enabled, onToggle, disabled, testId },
  ref,
) {
  const stateLabel = enabled ? "on" : "off";
  return (
    <Button
      ref={ref}
      type="button"
      variant="default"
      id={id}
      aria-pressed={enabled}
      data-testid={testId}
      disabled={disabled}
      className="h-7 w-fit px-2 font-mono text-[10px] tracking-[0.08em]"
      onClick={onToggle}
    >
      <span className="text-muted-foreground">{label} ·</span>{" "}
      <span
        className={cn(
          enabled ? "text-[hsl(var(--current))]" : "text-muted-foreground",
        )}
      >
        {stateLabel}
      </span>
    </Button>
  );
});
