import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import type { DerivedState, IssueDetail, IssueRecord } from "@server/schemas";
import { Rail, RailNode } from "@/components/ui/rail";
import { useIssuesQuery } from "../api/queries";
import { issuePath } from "../lib/links";
import {
  epicStoriesForRail,
  storyRailNodeState,
} from "../lib/epic-story-rail";

function StoryRailLabel({
  story,
  projectId,
}: {
  story: Extract<IssueRecord, { kind: "story" }>;
  projectId: string;
}) {
  return (
    <Link
      to={issuePath(projectId, story.id)}
      className="truncate text-sm hover:underline"
    >
      {story.title}
    </Link>
  );
}

function EpicStoryRailView({
  issue,
  issues,
  derived,
}: {
  issue: Extract<IssueDetail, { kind: "epic" }>;
  issues: IssueRecord[];
  derived: Record<string, DerivedState>;
}) {
  const { projectId = "" } = useParams();
  const stories = useMemo(
    () => epicStoriesForRail(issue.id, issues),
    [issue.id, issues],
  );
  if (stories.length === 0) return null;

  const live = stories.some(
    ({ story }) =>
      storyRailNodeState(story, derived[story.id], issues) === "in-flight",
  );

  return (
    <Rail live={live} data-testid="epic-story-rail">
      {stories.map(({ story }) => (
        <RailNode
          key={story.id}
          state={storyRailNodeState(story, derived[story.id], issues)}
          edge="solid"
          label={<StoryRailLabel story={story} projectId={projectId} />}
        />
      ))}
    </Rail>
  );
}

/** Single-spine Rail of an Epic's own ordered child Stories (detail own-flow). */
export function EpicStoryRail({
  issue,
}: {
  issue: Extract<IssueDetail, { kind: "epic" }>;
}) {
  const { data } = useIssuesQuery();
  const issues = useMemo(() => data?.issues ?? [], [data?.issues]);
  if (!data) return null;
  return (
    <EpicStoryRailView issue={issue} issues={issues} derived={data.derived} />
  );
}
