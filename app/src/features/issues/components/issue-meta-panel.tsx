import type { ReactNode } from "react";
import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { FIELD_LABELS } from "@server/fields";
import type { IssueDetail, IssuesResponse, ProjectLabel } from "@server/schemas";
import { isArchived } from "@server/services/archived-visibility";
import { type LabelAssignableIssue } from "../lib/project-labels";
import {
  overviewPropertyRows,
  type EpicMergeSettingsPanel,
  type OverviewPropertyRowId,
} from "../lib/overview-property-panels";
import { useSupplementedById } from "../hooks/use-supplemented-by-id";
import type { IssueSupplement } from "../hooks/use-supplemented-by-id";
import { useIssuesWithArchived } from "../hooks/use-issues-with-archived";
import {
  IssueAttentionReasonField,
  IssueNeedsAttentionField,
} from "./issue-attention-fields";
import { IssueAssigneeField } from "./issue-assignee-field";
import { IssueAssignmentLabelsField } from "./issue-assignment-labels-field";
import { IssueAppendToField } from "./issue-append-to-field";
import { IssuePartOfField } from "./issue-part-of-field";
import { IssueGeneratedIssuesField } from "./issue-generated-issues-field";
import { IssueSourceIdeaField } from "./issue-source-idea-field";
import { IssueSourceOutlineField } from "./issue-source-outline-field";
import { IssueStakeholderField } from "./issue-stakeholder-field";
import { CompactMetaBlock } from "./compact-meta";
import {
  buildStoryGitStackModel,
  GitStackPanelInner,
  GitStackPanelStoryOverviewPart,
  type StoryGitStackModel,
} from "./git-stack-panel";
import { StoryWorktreeRowFromIssuesResponse } from "./story-worktree-row";
import {
  RootMergeSettingsRows,
  rootMergeSettingsFor,
} from "./issue-root-merge-settings";
import { MetaRow } from "./meta-row";

function isRenderableNode(
  node: ReactNode,
): node is Exclude<ReactNode, null | undefined | false> {
  return node != null && node !== false;
}

type MergeSettingsBundle = NonNullable<
  ReturnType<typeof rootMergeSettingsFor>
>;

type RowRenderContext = {
  mergeSettingsBundle?: MergeSettingsBundle;
  gitData?: IssuesResponse;
  storyGitSupplement?: IssueSupplement;
  storyGitModel?: StoryGitStackModel;
  projectId?: string;
};

function renderOverviewPropertyRow(
  id: OverviewPropertyRowId,
  issue: IssueDetail,
  catalog: ProjectLabel[],
  gitPanel: "editable" | "fixed",
  ctx: RowRenderContext,
): ReactNode {
  switch (id) {
    case "partOf":
      return (
        <MetaRow
          key="partOf"
          label="Parent issue"
          value={
            <IssuePartOfField
              issue={issue as Extract<
                IssueDetail,
                { kind: "epic" | "story" | "task" }
              >}
            />
          }
        />
      );
    case "sourceIdea":
      return (
        <IssueSourceIdeaField
          key="sourceIdea"
          issue={issue as Extract<IssueDetail, { kind: "epic" | "story" }>}
        />
      );
    case "sourceOutline":
      return (
        <IssueSourceOutlineField
          key="sourceOutline"
          issue={issue as Extract<
            IssueDetail,
            { kind: "epic" | "story" | "task" }
          >}
        />
      );
    case "assignee":
      return (
        <MetaRow
          key="assignee"
          label={FIELD_LABELS.assignee}
          value={
            <IssueAssigneeField
              issue={issue as Extract<IssueDetail, { kind: "task" }>}
            />
          }
        />
      );
    case "labels":
      return (
        <MetaRow
          key="labels"
          label={FIELD_LABELS.labels}
          value={
            <IssueAssignmentLabelsField
              issue={issue as LabelAssignableIssue}
              catalog={catalog}
            />
          }
        />
      );
    case "appendTo":
      return (
        <MetaRow
          key="appendTo"
          label={FIELD_LABELS.appendTo}
          value={
            <IssueAppendToField
              issue={issue as Extract<IssueDetail, { kind: "idea" }>}
            />
          }
        />
      );
    case "stakeholder":
      return (
        <MetaRow
          key="stakeholder"
          label={FIELD_LABELS.stakeholder}
          value={
            <IssueStakeholderField
              issue={issue as Extract<IssueDetail, { kind: "idea" }>}
            />
          }
        />
      );
    case "generatedIssues":
      return (
        <IssueGeneratedIssuesField
          key="generatedIssues"
          issue={issue as Extract<IssueDetail, { kind: "idea" }>}
        />
      );
    case "codeApprovalRequired":
      return (
        <MetaRow
          key="codeApprovalRequired"
          label={FIELD_LABELS.codeApprovalRequired}
          value="Yes"
        />
      );
    case "needsAttention":
      return (
        <MetaRow
          key="needsAttention"
          label={FIELD_LABELS.needsAttention}
          value={
            <IssueNeedsAttentionField
              issue={issue as Extract<
                IssueDetail,
                { kind: "epic" | "story" | "task" }
              >}
            />
          }
        />
      );
    case "attentionReason":
      return (
        <MetaRow
          key="attentionReason"
          label={FIELD_LABELS.attentionReason}
          value={
            <IssueAttentionReasonField
              issue={issue as Extract<
                IssueDetail,
                { kind: "epic" | "story" | "task" }
              >}
            />
          }
        />
      );
    case "mergeSettings": {
      const bundle = ctx.mergeSettingsBundle;
      if (!bundle) return null;
      return (
        <RootMergeSettingsRows
          key="merge-settings"
          issue={issue as Extract<IssueDetail, { kind: "epic" | "story" }>}
          {...bundle}
        />
      );
    }
    case "git": {
      const data = ctx.gitData;
      if (!data) return null;
      if (issue.kind === "story") {
        const supplement = ctx.storyGitSupplement;
        const model = ctx.storyGitModel;
        const projectId = ctx.projectId;
        if (!supplement || !model || !projectId) return null;
        return (
          <GitStackPanelStoryOverviewPart
            key={`git-${gitPanel}`}
            issue={issue}
            panel={gitPanel}
            supplement={supplement}
            model={model}
            worktreeRow={
              gitPanel === "fixed" ? (
                <StoryWorktreeRowFromIssuesResponse
                  issue={issue}
                  projectId={projectId}
                  supplement={supplement}
                  data={data}
                />
              ) : undefined
            }
          />
        );
      }
      return (
        <GitStackPanelInner
          key={`git-${gitPanel}`}
          issue={issue}
          data={data}
          panel={gitPanel}
        />
      );
    }
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

function IssueMetaPanelSections({
  issue,
  catalog,
  editableIds,
  fixedIds,
  ctx,
}: {
  issue: IssueDetail;
  catalog: ProjectLabel[];
  editableIds: OverviewPropertyRowId[];
  fixedIds: OverviewPropertyRowId[];
  ctx: RowRenderContext;
}) {
  const editableRows = editableIds
    .map((id) => renderOverviewPropertyRow(id, issue, catalog, "editable", ctx))
    .filter(isRenderableNode);
  const fixedRows = fixedIds
    .map((id) => renderOverviewPropertyRow(id, issue, catalog, "fixed", ctx))
    .filter(isRenderableNode);

  if (editableRows.length === 0 && fixedRows.length === 0) {
    return null;
  }

  const showDivider = editableRows.length > 0 && fixedRows.length > 0;

  return (
    <CompactMetaBlock dataRegion="meta-scalars">
      {editableRows}
      {showDivider ? (
        <div
          role="separator"
          aria-orientation="horizontal"
          className="my-1.5 border-t border-border"
        />
      ) : null}
      {fixedRows}
    </CompactMetaBlock>
  );
}

function EpicIssueMetaPanelLoaded({
  issue,
  catalog,
  data,
}: {
  issue: Extract<IssueDetail, { kind: "epic" }>;
  catalog: ProjectLabel[];
  data: IssuesResponse;
}) {
  const { epicMerge, mergeSettingsBundle } = useMemo(() => {
    const settings = rootMergeSettingsFor(issue, data);
    if (!settings) {
      return {
        epicMerge: "omit" as EpicMergeSettingsPanel,
        mergeSettingsBundle: undefined as MergeSettingsBundle | undefined,
      };
    }
    return {
      epicMerge: (settings.lock.locked ? "fixed" : "editable") as EpicMergeSettingsPanel,
      mergeSettingsBundle: settings,
    };
  }, [issue, data]);

  const { editable: editableIds, fixed: fixedIds } = overviewPropertyRows(
    issue,
    epicMerge,
  );

  return (
    <IssueMetaPanelSections
      issue={issue}
      catalog={catalog}
      editableIds={editableIds}
      fixedIds={fixedIds}
      ctx={{ mergeSettingsBundle }}
    />
  );
}

function EpicIssueMetaPanelBody({
  issue,
  catalog,
}: {
  issue: Extract<IssueDetail, { kind: "epic" }>;
  catalog: ProjectLabel[];
}) {
  const { data } = useIssuesWithArchived(isArchived(issue));
  if (!data) return null;
  return (
    <EpicIssueMetaPanelLoaded issue={issue} catalog={catalog} data={data} />
  );
}

function StoryIssueMetaPanelLoaded({
  issue,
  catalog,
  data,
}: {
  issue: Extract<IssueDetail, { kind: "story" }>;
  catalog: ProjectLabel[];
  data: IssuesResponse;
}) {
  const { projectId = "" } = useParams();
  const chainIds = issue.stackedOn ? [issue.stackedOn] : [];
  const storyGitSupplement = useSupplementedById(chainIds, issue, data.issues);
  const storyGitModel = useMemo(
    () => buildStoryGitStackModel(issue, data, projectId),
    [issue, data, projectId],
  );

  const { editable: editableIds, fixed: fixedIds } = overviewPropertyRows(
    issue,
    "omit",
  );

  return (
    <IssueMetaPanelSections
      issue={issue}
      catalog={catalog}
      editableIds={editableIds}
      fixedIds={fixedIds}
      ctx={{
        gitData: data,
        storyGitSupplement,
        storyGitModel,
        projectId,
      }}
    />
  );
}

function StoryIssueMetaPanelBody({
  issue,
  catalog,
}: {
  issue: Extract<IssueDetail, { kind: "story" }>;
  catalog: ProjectLabel[];
}) {
  const { data } = useIssuesWithArchived(isArchived(issue));
  if (!data) return null;
  return (
    <StoryIssueMetaPanelLoaded issue={issue} catalog={catalog} data={data} />
  );
}

function TaskIssueMetaPanelBody({
  issue,
  catalog,
}: {
  issue: Extract<IssueDetail, { kind: "task" }>;
  catalog: ProjectLabel[];
}) {
  const { data } = useIssuesWithArchived(isArchived(issue));
  if (!data) return null;

  const { editable: editableIds, fixed: fixedIds } = overviewPropertyRows(
    issue,
    "omit",
  );

  return (
    <IssueMetaPanelSections
      issue={issue}
      catalog={catalog}
      editableIds={editableIds}
      fixedIds={fixedIds}
      ctx={{ gitData: data }}
    />
  );
}

function StoryTaskIssueMetaPanelBody({
  issue,
  catalog,
}: {
  issue: Extract<IssueDetail, { kind: "story" | "task" }>;
  catalog: ProjectLabel[];
}) {
  if (issue.kind === "story") {
    return <StoryIssueMetaPanelBody issue={issue} catalog={catalog} />;
  }
  return <TaskIssueMetaPanelBody issue={issue} catalog={catalog} />;
}

/**
 * Detail Overview properties: editable rows first, fixed rows after (hairline when both).
 */
export function IssueMetaPanel({
  issue,
  catalog = [],
}: {
  issue: IssueDetail;
  catalog?: ProjectLabel[];
}) {
  if (issue.kind === "epic") {
    return <EpicIssueMetaPanelBody issue={issue} catalog={catalog} />;
  }

  if (issue.kind === "story" || issue.kind === "task") {
    return <StoryTaskIssueMetaPanelBody issue={issue} catalog={catalog} />;
  }

  const { editable: editableIds, fixed: fixedIds } = overviewPropertyRows(
    issue,
    "omit",
  );

  return (
    <IssueMetaPanelSections
      issue={issue}
      catalog={catalog}
      editableIds={editableIds}
      fixedIds={fixedIds}
      ctx={{}}
    />
  );
}
