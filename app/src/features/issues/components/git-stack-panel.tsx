import { useMemo, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import type { IssueDetail, IssuesResponse } from "@server/schemas";
import { isArchived } from "@server/services/archived-visibility";
import { StoryCodeReviewRow } from "@/features/reviews/components/story-code-review-row";
import {
  storyGitMetaScalars,
  type GitMetaScalar,
} from "../lib/git-meta-scalars";
import { useIssuesWithArchived } from "../hooks/use-issues-with-archived";
import {
  IssueLinkResolution,
  useSupplementedById,
  type IssueSupplement,
} from "../hooks/use-supplemented-by-id";
import {
  StoryGitHeadScalarRows,
  StoryGitMetaScalars,
  StoryGitStackedOnRow,
  TaskGitMetaScalars,
} from "./issue-git-meta-scalars";
import { PrStatusPanel } from "./pr-status-panel";
import {
  RootMergeSettingsRows,
  rootMergeSettingsFor,
} from "./issue-root-merge-settings";

export type GitStackPanelSection = "editable" | "fixed" | "both";

export type StoryGitStackModel = {
  mergeBase?: string;
  storyScalars: GitMetaScalar[];
  beforeStackedOn: ReactNode;
  settingsNode: ReactNode | null;
  prNode: ReactNode | null;
  locked: boolean;
  hasMergeSettings: boolean;
};

/** Pure story-git derived UI (shared by Overview split and standalone stack panel). */
export function buildStoryGitStackModel(
  issue: Extract<IssueDetail, { kind: "story" }>,
  data: IssuesResponse,
  projectId: string,
): StoryGitStackModel {
  const mergeSettings = rootMergeSettingsFor(issue, data);
  const mergeBase = mergeSettings ? undefined : data.derived[issue.id]?.mergeBase;
  const storyScalars = storyGitMetaScalars(issue, mergeBase);
  const beforeStackedOn = (
    <StoryCodeReviewRow projectId={projectId} story={issue} />
  );
  const settingsNode = mergeSettings ? (
    <RootMergeSettingsRows issue={issue} {...mergeSettings} />
  ) : null;
  const prNode = issue.prUrl ? (
    <PrStatusPanel
      story={{ ...issue, prUrl: issue.prUrl }}
      projectId={projectId}
    />
  ) : null;
  const locked = mergeSettings?.lock.locked ?? false;

  return {
    mergeBase,
    storyScalars,
    beforeStackedOn,
    settingsNode,
    prNode,
    locked,
    hasMergeSettings: mergeSettings != null,
  };
}

function renderStoryGitPanel(
  issue: Extract<IssueDetail, { kind: "story" }>,
  panel: GitStackPanelSection,
  supplement: IssueSupplement,
  model: StoryGitStackModel,
): ReactNode {
  const {
    mergeBase,
    storyScalars,
    beforeStackedOn,
    settingsNode,
    prNode,
    locked,
    hasMergeSettings,
  } = model;

  const resolution = (
    <IssueLinkResolution
      missingIds={supplement.missingIds}
      accept={supplement.accept}
      reject={supplement.reject}
    />
  );

  if (panel === "both") {
    return (
      <>
        {resolution}
        <StoryGitMetaScalars
          issue={issue}
          mergeBase={mergeBase}
          scalars={storyScalars}
          mergeSettings={settingsNode}
          beforeStackedOn={beforeStackedOn}
        />
        {prNode}
      </>
    );
  }

  if (panel === "editable") {
    if (!hasMergeSettings) {
      return (
        <>
          {resolution}
          {beforeStackedOn}
          <StoryGitStackedOnRow
            issue={issue}
            mergeBase={mergeBase}
            scalars={storyScalars}
          />
        </>
      );
    }
    return (
      <>
        {resolution}
        {!locked ? settingsNode : null}
        {beforeStackedOn}
        <StoryGitStackedOnRow
          issue={issue}
          mergeBase={mergeBase}
          scalars={storyScalars}
        />
      </>
    );
  }

  return (
    <>
      <StoryGitHeadScalarRows
        issue={issue}
        mergeBase={mergeBase}
        scalars={storyScalars}
      />
      {hasMergeSettings && locked ? settingsNode : null}
      {prNode}
    </>
  );
}

/** Overview: split panels; caller owns `useSupplementedById` + `buildStoryGitStackModel`. */
export function GitStackPanelStoryOverviewPart({
  issue,
  panel,
  supplement,
  model,
}: {
  issue: Extract<IssueDetail, { kind: "story" }>;
  panel: "editable" | "fixed";
  supplement: IssueSupplement;
  model: StoryGitStackModel;
}) {
  return renderStoryGitPanel(issue, panel, supplement, model);
}

function GitStackPanelStoryWithHook({
  issue,
  data,
  panel,
}: {
  issue: Extract<IssueDetail, { kind: "story" }>;
  data: IssuesResponse;
  panel: GitStackPanelSection;
}) {
  const { projectId = "" } = useParams();
  const chainIds = issue.stackedOn ? [issue.stackedOn] : [];
  const supplement = useSupplementedById(chainIds, issue, data.issues);
  const model = useMemo(
    () => buildStoryGitStackModel(issue, data, projectId),
    [issue, data, projectId],
  );
  return renderStoryGitPanel(issue, panel, supplement, model);
}

function GitStackPanelTask({
  issue,
  data,
  panel,
}: {
  issue: Extract<IssueDetail, { kind: "task" }>;
  data: IssuesResponse;
  panel: GitStackPanelSection;
}) {
  const supplement = useSupplementedById([issue.partOf], issue, data.issues);
  const issueRecords = useMemo(
    () => [...supplement.byId.values()],
    [supplement.byId],
  );

  const resolution = (
    <IssueLinkResolution
      missingIds={supplement.missingIds}
      accept={supplement.accept}
      reject={supplement.reject}
    />
  );

  const body = (
    <>
      {resolution}
      <TaskGitMetaScalars issue={issue} issues={issueRecords} />
    </>
  );
  if (panel === "editable") {
    return null;
  }
  return body;
}

/** Git/stack body when the issues snapshot is already loaded (Overview shares one list per issue). */
export function GitStackPanelInner({
  issue,
  data,
  panel = "both",
}: {
  issue: IssueDetail;
  data: IssuesResponse;
  panel?: GitStackPanelSection;
}) {
  if (issue.kind === "task") {
    return <GitStackPanelTask issue={issue} data={data} panel={panel} />;
  }

  if (issue.kind !== "story") {
    return null;
  }

  return <GitStackPanelStoryWithHook issue={issue} data={data} panel={panel} />;
}

/** Git/spec rows for story/task detail (fragments; parent owns panel chrome). */
export function GitStackPanel({
  issue,
  panel = "both",
}: {
  issue: IssueDetail;
  /** `both` preserves the pre-split single-block layout (tests and callers). */
  panel?: GitStackPanelSection;
}) {
  const { data } = useIssuesWithArchived(isArchived(issue));
  if (!data) return null;
  return <GitStackPanelInner issue={issue} panel={panel} data={data} />;
}
