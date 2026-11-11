import { useMemo } from "react";
import { FIELD_LABELS } from "@server/fields";
import type { IssueDetail, IssueRecord } from "@server/schemas";
import { taskHeadCommit } from "@server/services/commit-sha";
import { Rail, RailNode } from "@/components/ui/rail";
import { useIssuesWithArchived } from "../hooks/use-issues-with-archived";
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

function IssueTitleLinkList({
  ids,
  byId,
}: {
  ids: string[];
  byId: Map<string, IssueRecord>;
}) {
  return (
    <span className="flex flex-col gap-1">
      {ids.map((id) => {
        const record = byId.get(id);
        const title = record?.title ?? id;
        return (
          <IssueLink
            key={id}
            id={id}
            className="text-primary hover:underline"
          >
            {title}
          </IssueLink>
        );
      })}
    </span>
  );
}

export function IssueGeneratedIssuesField({ issue }: { issue: IdeaDetail }) {
  const { data } = useIssuesWithArchived(true);
  const derived = data?.derived?.[issue.id];
  const generatedOutlines = derived?.generatedOutlines ?? [];
  const planRoots = derived?.planRoots ?? [];
  const issues = data?.issues ?? [];
  const byId = useMemo(() => issuesById(issues), [issues]);
  const appendedTasks = useMemo(
    () =>
      generatedOutlines.length === 0 && issue.appendTo
        ? ideaAppendedTasksForRail(issue.id, issues)
        : [],
    [generatedOutlines.length, issue.appendTo, issue.id, issues],
  );

  if (generatedOutlines.length > 0) {
    return (
      <MetaRow
        label={FIELD_LABELS.generatedOutline}
        value={
          <IssueTitleLinkList ids={generatedOutlines} byId={byId} />
        }
      />
    );
  }

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
      value={<IssueTitleLinkList ids={planRoots} byId={byId} />}
    />
  );
}
