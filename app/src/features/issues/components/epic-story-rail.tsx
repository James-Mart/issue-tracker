import { useMemo } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import type { DerivedState, IssueDetail, IssueRecord } from "@server/schemas";
import { Rail, RailNode } from "@/components/ui/rail";
import { useIssuesQuery } from "../api/queries";
import {
  type IssueBackLocationState,
  issueBackNavigateState,
} from "../lib/issue-back";
import { issuePath } from "../lib/links";
import {
  epicStoriesForRail,
  storyRailNodeState,
} from "../lib/epic-story-rail";

/** Same step as `TREE_INDENT` in `issue-tree.tsx`. */
const RAIL_INDENT = 24;

function StoryRailLabel({
  story,
  projectId,
}: {
  story: Extract<IssueRecord, { kind: "story" }>;
  projectId: string;
}) {
  const location = useLocation();
  const linkState = issueBackNavigateState(
    location.pathname,
    location.search,
    (location.state as IssueBackLocationState | null)?.issueBackStack,
  );

  return (
    <Link
      to={issuePath(projectId, story.id)}
      state={linkState}
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
      {stories.map(({ story, depth }) => (
        <RailNode
          key={story.id}
          state={storyRailNodeState(story, derived[story.id], issues)}
          edge="solid"
          label={
            <span
              style={
                depth > 0 ? { marginLeft: depth * RAIL_INDENT } : undefined
              }
            >
              <StoryRailLabel story={story} projectId={projectId} />
            </span>
          }
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
