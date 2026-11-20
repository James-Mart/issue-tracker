import { FIELD_LABELS } from "@server/fields";
import type { ExecutionGate } from "@server/schemas";
import { cn } from "@/lib/utils/cn";
import {
  IDEA_EXECUTION_GATE_OPTIONS,
  ideaExecutionGateOption,
} from "../lib/idea-execution-gate-options";

function nextExecutionGate(
  current: ExecutionGate,
  key: string,
): { value: ExecutionGate; index: number } | undefined {
  const index = IDEA_EXECUTION_GATE_OPTIONS.findIndex(
    (option) => option.value === current,
  );
  const last = IDEA_EXECUTION_GATE_OPTIONS.length - 1;
  const nextIndex =
    key === "ArrowRight" || key === "ArrowDown"
      ? index === last
        ? 0
        : index + 1
      : key === "ArrowLeft" || key === "ArrowUp"
        ? index === 0
          ? last
          : index - 1
        : undefined;
  if (nextIndex === undefined) return undefined;
  return {
    value: IDEA_EXECUTION_GATE_OPTIONS[nextIndex].value,
    index: nextIndex,
  };
}

/** Auto / On / Off for a stored `executionGate`. Opens on the value it is given. */
export function ExecutionGateControl({
  id,
  value,
  onChange,
  disabled,
  testId,
}: {
  id: string;
  value: ExecutionGate;
  onChange: (next: ExecutionGate) => void;
  disabled?: boolean;
  testId: string;
}) {
  return (
    <div
      id={id}
      role="radiogroup"
      aria-label={FIELD_LABELS.executionGate}
      data-testid={testId}
      data-value={ideaExecutionGateOption(value).slug}
      className="inline-flex h-7 w-fit items-center rounded-md border border-border bg-card px-2 font-mono text-[10px] tracking-[0.08em] touch:h-11"
      onKeyDown={(event) => {
        if (disabled) return;
        const next = nextExecutionGate(value, event.key);
        if (next === undefined) return;
        event.preventDefault();
        onChange(next.value);
        const radios = event.currentTarget.querySelectorAll<HTMLButtonElement>(
          'button[role="radio"]',
        );
        radios[next.index]?.focus();
      }}
    >
      <span aria-hidden className="text-muted-foreground">
        {FIELD_LABELS.executionGate} ·
      </span>
      {IDEA_EXECUTION_GATE_OPTIONS.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.slug}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            data-testid={`${testId}-${option.slug}`}
            disabled={disabled}
            className={cn(
              "h-full rounded-sm px-1.5 touch:min-w-11",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? "text-[hsl(var(--current))]"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
