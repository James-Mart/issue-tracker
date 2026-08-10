import {
  MANUAL_STAKEHOLDER_LABEL,
  MANUAL_STAKEHOLDER_VALUE,
} from "@server/fields";
import type { AgentModel } from "@/features/agents/api/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function StakeholderSelect({
  id,
  value,
  models,
  disabled,
  loading,
  onChange,
}: {
  id?: string;
  /** Stored slug, or undefined for manual planning. */
  value: string | undefined;
  models: AgentModel[];
  disabled?: boolean;
  loading?: boolean;
  onChange: (value: string | null) => void;
}) {
  const selectValue = value ?? MANUAL_STAKEHOLDER_VALUE;

  return (
    <Select
      value={selectValue}
      disabled={disabled || loading}
      onValueChange={(next) =>
        onChange(next === MANUAL_STAKEHOLDER_VALUE ? null : next)
      }
    >
      <SelectTrigger id={id} className="font-mono">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={MANUAL_STAKEHOLDER_VALUE}>
          {MANUAL_STAKEHOLDER_LABEL}
        </SelectItem>
        {models.map((model) => (
          <SelectItem key={model.id} value={model.id}>
            {model.displayName ?? model.id}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
