import { FIELD_LABELS } from "@server/fields";
import { cn } from "@/lib/utils/cn";
import { ideaExecutionGateOption } from "../lib/idea-execution-gate-options";
import type { IdeaPlanSettingsState } from "./idea-plan-settings";

export function IdeaExecutionGateEffectLine({
  settings,
  className,
}: {
  settings: IdeaPlanSettingsState;
  className?: string;
}) {
  if (!settings.shown.execution) {
    return null;
  }
  const option = ideaExecutionGateOption(settings.execution);
  return (
    <p
      data-testid="idea-execution-gate-effect"
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