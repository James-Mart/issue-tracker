import type { TaskStatus } from "@server/schemas";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";
import {
  TASK_STATUS_BADGE_VARIANT,
  TASK_STATUS_LABEL,
} from "../lib/derived";

export function TaskStatusChips({
  status,
  className,
}: {
  status: TaskStatus;
  className?: string;
}) {
  return (
    <span className={cn("flex items-center gap-1.5", className)}>
      <Badge variant={TASK_STATUS_BADGE_VARIANT[status]}>
        {TASK_STATUS_LABEL[status]}
      </Badge>
    </span>
  );
}
