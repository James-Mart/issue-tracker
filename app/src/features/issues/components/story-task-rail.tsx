import { useMemo } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import type { IssueDetail, IssueRecord } from "@server/schemas";
import { Rail, RailNode } from "@/components/ui/rail";
import { useIssuesQuery } from "../api/queries";
import {
  type IssueBackLocationState,
  issueBackNavigateState,
} from "../lib/issue-back";
import { issuePath } from "../lib/links";
import {
  storyTasksForRail,
  taskRailNodeState,
} from "../lib/story-task-rail";

function TaskRailLabel({
  task,
  projectId,
}: {
  task: Extract<IssueRecord, { kind: "task" }>;
  projectId: string;
}) {
  const location = useLocation();
  const linkState = issueBackNavigateState(
    location.pathname,
    location.search,
    (location.state as IssueBackLocationState | null)?.issueBackStack,
  );
  const shortSha = task.commitSha?.slice(0, 7);
  return (
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
          label={<TaskRailLabel task={task} projectId={projectId} />}
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
