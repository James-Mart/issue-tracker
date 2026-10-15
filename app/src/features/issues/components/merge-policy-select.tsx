import { MERGE_POLICY_LABELS, MERGE_POLICY_OPTIONS } from "@server/fields";
import type { MergePolicy } from "@server/schemas";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type MergePolicySelectProps = {
  id?: string;
  disabled?: boolean;
} & (
  | {
      inheritLabel?: undefined;
      value: MergePolicy;
      onChange: (value: MergePolicy) => void;
    }
  | {
      /** Label for the clear-override option, e.g. "Inherit (Manual)". */
      inheritLabel: string;
      value: MergePolicy | "inherit";
      onChange: (value: MergePolicy | "inherit") => void;
    }
);

export function MergePolicySelect(props: MergePolicySelectProps) {
  const selectedLabel =
    props.inheritLabel !== undefined
      ? props.value === "inherit"
        ? props.inheritLabel
        : MERGE_POLICY_LABELS[props.value]
      : undefined;

  return (
    <Select
      value={props.value}
      disabled={props.disabled}
      onValueChange={(next) => {
        if (props.inheritLabel !== undefined) {
          props.onChange(next === "inherit" ? "inherit" : (next as MergePolicy));
          return;
        }
        props.onChange(next as MergePolicy);
      }}
    >
      <SelectTrigger id={props.id}>
        {selectedLabel ? (
          <SelectValue>{selectedLabel}</SelectValue>
        ) : (
          <SelectValue />
        )}
      </SelectTrigger>
      <SelectContent>
        {props.inheritLabel !== undefined ? (
          <SelectItem value="inherit">{props.inheritLabel}</SelectItem>
        ) : null}
        {MERGE_POLICY_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
