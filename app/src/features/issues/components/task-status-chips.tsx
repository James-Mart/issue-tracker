import type { TaskStatus } from "@server/schemas";
import { AxisChips, BEHIND_AXIS_CHIP, type AxisChip } from "./axis-chips";
import {
  TASK_STATUS_BADGE_VARIANT,
  TASK_STATUS_LABEL,
} from "../lib/derived";

export function TaskStatusChips({
  status,
  behind,
  className,
}: {
  status: TaskStatus;
  behind?: boolean;
  className?: string;
}) {
  const chips: AxisChip[] = [
    {
      variant: TASK_STATUS_BADGE_VARIANT[status],
      label: TASK_STATUS_LABEL[status],
    },
  ];
  if (behind) chips.push(BEHIND_AXIS_CHIP);
  return <AxisChips chips={chips} className={className} />;
}
