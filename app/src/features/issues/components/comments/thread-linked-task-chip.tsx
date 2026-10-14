import { IssueChip } from "../issue-chip";

/** Task chip for a Story diff thread linked to the Task that addresses it. */
export function ThreadLinkedTaskChip({ taskId }: { taskId: string }) {
  return <IssueChip id={taskId} testId="thread-linked-task" />;
}
