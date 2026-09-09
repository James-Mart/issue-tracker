import { useMemo } from "react";
import { FIELD_LABELS } from "@server/fields";
import type { IssueDetail, IssueRecord } from "@server/schemas";
import { taskHeadCommit } from "@server/services/commit-sha";
import { Rail, RailNode } from "@/components/ui/rail";
import { useIssuesQuery } from "../api/queries";
import { issuesById } from "../lib/build-tree";
import {
  ideaAppendedTasksForRail,
  taskRailNodeState,
} from "../lib/story-task-rail";
import { IssueLink } from "./issue-link";
import { MetaRow } from "./meta-row";

type IdeaDetail = Extract<IssueDetail, { kind: "idea" }>;
type TaskRecord = Extract<IssueRecord, { kind: "task" }>;

function GeneratedTaskRailLabel({ task }: { task: TaskRecord }) {
  const shortSha = taskHeadCommit(task)?.slice(0, 7);
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <IssueLink id={task.id} className="truncate text-sm hover:underline">
        {task.title}
      </IssueLink>
      {shortSha ? (
        <span className="font-mono text-[12px] tabular-nums text-muted-foreground">
          {shortSha}
        </span>
      ) : null}
    </span>
  );
}

function AppendedTasksRail({ tasks }: { tasks: TaskRecord[] }) {
  const live = tasks.some((task) => taskRailNodeState(task) === "in-flight");
  return (
    <Rail live={live} data-testid="generated-issues-rail">
      {tasks.map((task) => (
        <RailNode
          key={task.id}
          state={taskRailNodeState(task)}
          edge="solid"
          label={<GeneratedTaskRailLabel task={task} />}
        />
      ))}
    </Rail>
  );
}

export function IssueGeneratedIssuesField({ issue }: { issue: IdeaDetail }) {
  const { data } = useIssuesQuery();
  const planRoots = data?.derived?.[issue.id]?.planRoots ?? [];
  const issues = data?.issues ?? [];
  const byId = useMemo(() => issuesById(issues), [issues]);
  const appendedTasks = useMemo(
    () =>
      issue.appendTo ? ideaAppendedTasksForRail(issue.id, issues) : [],
    [issue.appendTo, issue.id, issues],
  );

  if (issue.appendTo) {
    if (appendedTasks.length === 0) return null;
    return (
      <MetaRow
        label={FIELD_LABELS.generatedIssues}
        value={<AppendedTasksRail tasks={appendedTasks} />}
      />
    );
  }

  if (planRoots.length === 0) return null;

  return (
    <MetaRow
      label={FIELD_LABELS.generatedIssues}
      value={
        <span className="flex flex-col gap-1">
          {planRoots.map((rootId) => {
            const root = byId.get(rootId);
            const title = root?.title ?? rootId;
            return (
              <IssueLink key={rootId} id={rootId}>
                {title}
              </IssueLink>
            );
          })}
        </span>
      }
    />
  );
}
