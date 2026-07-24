import type { QaStatus, TaskStatus } from "@server/schemas";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";
import {
  QA_STATUS_BADGE_VARIANT,
  QA_STATUS_LABEL,
  TASK_STATUS_BADGE_VARIANT,
  TASK_STATUS_LABEL,
} from "../lib/derived";

export function TaskStatusChips({
  status,
  qa,
  className,
}: {
  status: TaskStatus;
  qa?: QaStatus;
  className?: string;
}) {
  return (
    <span className={cn("flex items-center gap-1.5", className)}>
      <Badge variant={TASK_STATUS_BADGE_VARIANT[status]}>
        {TASK_STATUS_LABEL[status]}
      </Badge>
      {qa ? (
        <Badge variant={QA_STATUS_BADGE_VARIANT[qa]}>
          qa: {QA_STATUS_LABEL[qa]}
        </Badge>
      ) : null}
    </span>
  );
}
