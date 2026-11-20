import type { IdeaPlanSettingsState } from "./idea-plan-settings";
import { ExecutionGateEffectLine } from "./execution-gate-effect-line";

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
  return (
    <ExecutionGateEffectLine value={settings.execution} className={className} />
  );
}
