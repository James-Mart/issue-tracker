import { useMemo } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import type { IssueDetail, IssueRecord } from "@server/schemas";
import { taskHeadCommit } from "@server/services/commit-sha";
import { Rail, RailNode } from "@/components/ui/rail";
import { useIssuesQuery } from "../api/queries";
import { issuesById } from "../lib/build-tree";
import {
  type IssueBackLocationState,
  issueBackNavigateState,
} from "../lib/issue-back";
import { issuePath } from "../lib/links";
import { SETTINGS_HEADING_CLASS } from "./detail-section";
import {
  firstAppendedTaskId,
  storyTasksForRail,
  taskRailNodeState,
} from "../lib/story-task-rail";

type TaskRecord = Extract<IssueRecord, { kind: "task" }>;

function TaskRailLabel({
  task,
  projectId,
  byId,
  showAppendedCaption,
}: {
  task: TaskRecord;
  projectId: string;
  byId: Map<string, IssueRecord>;
  showAppendedCaption: boolean;
}) {
  const location = useLocation();
  const linkState = issueBackNavigateState(
    location.pathname,
    location.search,
    (location.state as IssueBackLocationState | null)?.issueBackStack,
  );
  const shortSha = taskHeadCommit(task)?.slice(0, 7);
  const sourceIdeaId = task.sourceIdea;
  const sourceIdeaTitle =
    sourceIdeaId != null
      ? (byId.get(sourceIdeaId)?.title ?? sourceIdeaId)
      : undefined;

  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      {showAppendedCaption ? (
        <span
          className={SETTINGS_HEADING_CLASS}
          data-testid="story-task-rail-appended-caption"
        >
          Appended
        </span>
      ) : null}
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <Link
          to={issuePath(projectId, task.id)}
          state={linkState}
          className="truncate text-sm hover:underline"
        >
          {task.title}
        </Link>
        {shortSha ? (
          <span className="font-mono text-[12px] tabular-nums text-muted-foreground">
            {shortSha}
          </span>
        ) : null}
      </span>
      {sourceIdeaTitle ? (
        <span
          className="font-mono text-[11px] text-muted-foreground"
          data-testid="task-source-idea"
        >
          from{" "}
          <span className="text-[hsl(var(--current))]">{sourceIdeaTitle}</span>
        </span>
      ) : null}
    </span>
  );
}

function StoryTaskRailView({
  issue,
  issues,
}: {
  issue: Extract<IssueDetail, { kind: "story" }>;
  issues: IssueRecord[];
}) {
  const { projectId = "" } = useParams();
  const tasks = useMemo(
    () => storyTasksForRail(issue.id, issues),
    [issue.id, issues],
  );
  const byId = useMemo(() => issuesById(issues), [issues]);
  const appendedBoundaryId = useMemo(
    () => firstAppendedTaskId(tasks),
    [tasks],
  );
  if (tasks.length === 0) return null;

  // A task on the spine is in-flight when an agent is actively working it.
  const live = tasks.some((task) => taskRailNodeState(task) === "in-flight");

  return (
    <Rail live={live} data-testid="story-task-rail">
      {tasks.map((task) => (
        <RailNode
          key={task.id}
          state={taskRailNodeState(task)}
          edge="solid"
          label={
            <TaskRailLabel
              task={task}
              projectId={projectId}
              byId={byId}
              showAppendedCaption={task.id === appendedBoundaryId}
            />
          }
        />
      ))}
    </Rail>
  );
}

/** Single-spine Rail of a Story's own ordered tasks (detail own-flow). */
export function StoryTaskRail({
  issue,
}: {
  issue: Extract<IssueDetail, { kind: "story" }>;
}) {
  const { data } = useIssuesQuery();
  const issues = useMemo(() => data?.issues ?? [], [data?.issues]);
  if (!data) return null;
  return (
    <StoryTaskRailView issue={issue} issues={issues} />
  );
}
