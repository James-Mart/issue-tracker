import { FIELD_LABELS } from "@server/fields";
import type { ExecutionGate } from "@server/schemas";
import { cn } from "@/lib/utils/cn";
import { ideaExecutionGateOption } from "../lib/idea-execution-gate-options";

/** Label and effect sentence for one stored execution gate. */
export function ExecutionGateEffectLine({
  value,
  className,
  testId = "idea-execution-gate-effect",
}: {
  value: ExecutionGate;
  className?: string;
  testId?: string;
}) {
  const option = ideaExecutionGateOption(value);
  return (
    <p
      data-testid={testId}
      className={cn(
        "text-pretty text-center text-[11px] leading-snug",
        className,
      )}
    >
      <span className="text-muted-foreground">{FIELD_LABELS.executionGate} · </span>
      <span className="text-[hsl(var(--current))]">{option.label}</span>
      <span className="text-muted-foreground"> — {option.effect}.</span>
    </p>
  );
}
