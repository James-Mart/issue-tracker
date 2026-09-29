import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { useIssuesQuery } from "../../api/queries";
import { issuesById } from "../../lib/build-tree";
import { IssueLink } from "../issue-link";

/** Task chip for a Story diff thread linked to the Task that addresses it. */
export function ThreadLinkedTaskChip({ taskId }: { taskId: string }) {
  const { data } = useIssuesQuery();
  const byId = useMemo(
    () => issuesById(data?.issues ?? []),
    [data?.issues],
  );
  const task = byId.get(taskId);
  const title = task?.kind === "task" ? task.title : taskId;

  return (
    <span
      className="inline-flex max-w-full min-w-0 shrink-0"
      data-testid="thread-linked-task"
    >
      <IssueLink
        id={taskId}
        className="inline-flex max-w-full min-w-0 hover:underline"
      >
        <Badge
          variant="secondary"
          className="inline-flex max-w-full min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 whitespace-normal font-normal hover:border-[hsl(var(--rail-lit))]"
        >
          <span>{title}</span>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {taskId}
          </span>
        </Badge>
      </IssueLink>
    </span>
  );
}
