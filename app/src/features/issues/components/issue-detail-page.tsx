import { useMemo, type ReactNode } from "react";
import { Link, Navigate, useLocation, useParams, useSearchParams } from "react-router-dom";
import { tabTitleEntityName, useTabTitle } from "@/lib/tab-title/use-tab-title";
import { ArrowLeft } from "lucide-react";
import { isArchived } from "@server/services/archived-visibility";
import type { IssueDetail, IssueKind, ProjectLabel } from "@server/schemas";
import { ApiError } from "@/lib/api/errors";
import {
  ShellFaultDetail,
  ShellInlineFault,
  ShellLoadingState,
  ShellState,
} from "@/app/shell-state";
import { PageShell } from "@/components/page-shell";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils/cn";
import { useChannelSessionsQuery, useIssueDetailQuery } from "../api/queries";
import { useIssuesWithArchived } from "../hooks/use-issues-with-archived";
import {
  MissingIssueRecords,
  useSupplementedById,
} from "../hooks/use-supplemented-by-id";
import { useUploadAttachment } from "../api/mutations";
import {
  useIssueDetailFileUpload,
  type UploadAttachmentMutation,
} from "../hooks/use-issue-detail-file-upload";
import { kindHasOwnFlow } from "../lib/own-flow";
import { issueBelongsToProject } from "../lib/build-tree";
import {
  channelTabForIssue,
  issueDetailTabNeedsBoundedShell,
  issueDetailTabTitleSuffix,
  mobileChannelChromeForTab,
  resolveIssueDetailTab,
  tabsForIssueDetail,
  type IssueDetailTab,
} from "../lib/issue-detail-tabs";
import { projectHomeTitleSuffix } from "../lib/project-home";
import { projectPath } from "../lib/links";
import { reviewIssuePath } from "@/features/reviews/lib/links";
import {
  issueBackTo,
  peekIssueBack,
  popIssueBack,
  type IssueBackLocationState,
} from "../lib/issue-back";
import { projectCatalogLabels } from "../lib/project-labels";
import { IssueMetaPanel } from "./issue-meta-panel";
import { IssueDetailHeader } from "./issue-detail-header";
import { IssueDetailTabs } from "./issue-detail-tabs";
import { ProjectHome } from "./project-home";
import { StoryHumanRequestCard } from "./story-human-request-card";
import { StoryTaskRail } from "./story-task-rail";
import { EpicStoryRail } from "./epic-story-rail";
import { IssueAttachmentsSection } from "./attachments-panel";
import { IssueDescriptionField } from "./issue-description-field";
import { OutlineBodyCard } from "./outline-body-card";
import { OutlineLinkedWorkCard } from "./outline-linked-work-card";
import {
  OutlinePendingDraftCard,
  type OutlineWithDraft,
} from "./outline-pending-draft-card";
import { IssueCommentsSection } from "./comments/comments-section";
import { DeletePartialPlanDetailAction } from "./delete-partial-plan-control";
import { OverviewIconToolbar } from "./overview-icon-toolbar";
import { PlanningOverviewLaunch } from "./planning-launch-control";
import { supportsAttachments } from "../lib/attachments";

/** Match Agents: subtract the app top bar (3rem), not raw 100svh. */
const BOUNDED_DETAIL_SHELL_CLASS =
  "h-[calc(100svh-3rem)] min-h-0 overflow-hidden";

/**
 * Own-flow area for `surfaces-detail-flow`. Story: single-spine task Rail.
 * Epic: single-spine child-Story Rail. Idea / Task / Project leave the slot
 * empty.
 */
function OwnFlowSlot({ issue }: { issue: IssueDetail }) {
  if (!kindHasOwnFlow(issue.kind)) return null;
  return (
    <div data-region="own-flow">
      {issue.kind === "story" ? <StoryTaskRail issue={issue} /> : null}
      {issue.kind === "epic" ? <EpicStoryRail issue={issue} /> : null}
    </div>
  );
}

function IssueOverviewLaunch({
  issue,
  parentKind,
}: {
  issue: IssueDetail;
  parentKind?: IssueKind;
}) {
  const channel = channelTabForIssue(issue, parentKind);
  const { data: sessions, isLoading } = useChannelSessionsQuery(
    channel ? issue.id : "",
    channel ?? "implementing",
  );
  if (!channel || isLoading || (sessions?.length ?? 0) > 0) return null;
  if (channel === "planning" && issue.kind === "idea") {
    return (
      <div data-testid="issue-overview-launch">
        <PlanningOverviewLaunch issue={issue} />
      </div>
    );
  }
  return null;
}

function IssueOverviewPanel({
  issue,
  upload,
  catalog,
  projectId,
  parentKind,
}: {
  issue: IssueDetail;
  upload?: UploadAttachmentMutation;
  catalog: ProjectLabel[];
  projectId: string;
  parentKind?: IssueKind;
}) {
  const { data: list } = useIssuesWithArchived(isArchived(issue));
  const awaitingDirection =
    issue.kind === "idea" &&
    list?.derived?.[issue.id]?.ideaStatus === "awaiting-direction";

  return (
    <div className="flex flex-col gap-4">
      <IssueMetaPanel issue={issue} catalog={catalog} />
      {issue.kind === "story" || issue.kind === "epic" ? (
        <OverviewIconToolbar issue={issue} parentKind={parentKind} />
      ) : null}
      {issue.kind === "story" ? <StoryHumanRequestCard issue={issue} /> : null}
      <IssueOverviewLaunch issue={issue} parentKind={parentKind} />
      {awaitingDirection ? (
        <DeletePartialPlanDetailAction issue={issue} />
      ) : null}
      <OwnFlowSlot issue={issue} />
      <IssueAttachmentsSection issue={issue} upload={upload} />
      {issue.kind === "outline" ? (
        <OutlineLinkedWorkCard key={`${issue.id}-linked`} issue={issue} />
      ) : null}
      {issue.kind === "outline" && issue.pendingDraft !== undefined ? (
        <OutlinePendingDraftCard
          key={`${issue.id}-draft`}
          issue={issue as OutlineWithDraft}
        />
      ) : null}
      {issue.kind === "outline" ? (
        <OutlineBodyCard key={issue.id} issue={issue} />
      ) : (
        <IssueDescriptionField issue={issue} upload={upload} />
      )}
      <IssueCommentsSection issue={issue} />
    </div>
  );
}

function parentKindForIssue(
  issue: IssueDetail,
  projectId: string,
  byId: Map<string, { kind: IssueKind }>,
): IssueKind | undefined {
  if (issue.kind !== "story") return undefined;
  if (issue.partOf === projectId) return "project";
  return byId.get(issue.partOf)?.kind;
}

function IssueDetailBody({
  issue,
  upload,
  catalog,
  projectId,
  parentKind,
  tabs,
  compactChannelChrome,
}: {
  issue: IssueDetail;
  upload?: UploadAttachmentMutation;
  catalog: ProjectLabel[];
  projectId: string;
  parentKind?: IssueKind;
  tabs: readonly IssueDetailTab[];
  compactChannelChrome: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col",
        compactChannelChrome ? "gap-0" : "gap-4",
      )}
    >
      {compactChannelChrome ? null : (
        <div className="shrink-0" data-testid="issue-detail-header">
          <IssueDetailHeader issue={issue} catalog={catalog} />
        </div>
      )}

      {issue.kind === "project" ? (
        <ProjectHome
          issue={issue}
          projectId={projectId}
          catalog={catalog}
          upload={upload}
        />
      ) : (
        <IssueDetailTabs
          issue={issue}
          projectId={projectId}
          parentKind={parentKind}
          tabs={tabs}
          overview={
            <IssueOverviewPanel
              issue={issue}
              upload={upload}
              catalog={catalog}
              projectId={projectId}
              parentKind={parentKind}
            />
          }
        />
      )}
    </div>
  );
}

/** Owns the shared upload mutation + page drop/paste target for attachable issues. */
function IssueDetailAttachable({
  issue,
  projectId,
  backLink,
  catalog,
  parentKind,
  tabs,
  boundShell,
  compactChannelChrome,
}: {
  issue: IssueDetail;
  projectId: string;
  backLink: ReactNode;
  catalog: ProjectLabel[];
  parentKind?: IssueKind;
  tabs: readonly IssueDetailTab[];
  boundShell: boolean;
  compactChannelChrome: boolean;
}) {
  const upload = useUploadAttachment(issue.id);
  const { rootProps } = useIssueDetailFileUpload(upload);

  return (
    <PageShell
      {...rootProps}
      className={cn(
        boundShell && BOUNDED_DETAIL_SHELL_CLASS,
        compactChannelChrome && "gap-0 px-0 py-0",
        rootProps.className,
      )}
    >
      {compactChannelChrome ? null : (
        <div className="shrink-0" data-testid="issue-detail-back">
          {backLink}
        </div>
      )}
      <IssueDetailBody
        issue={issue}
        upload={upload}
        catalog={catalog}
        projectId={projectId}
        parentKind={parentKind}
        tabs={tabs}
        compactChannelChrome={compactChannelChrome}
      />
    </PageShell>
  );
}

function useIssueDetailShellFlags(
  issue: IssueDetail | undefined,
  tabs: readonly IssueDetailTab[],
  tabParam: string | null,
): { boundShell: boolean; compactChannelChrome: boolean } {
  const isMobile = useIsMobile();
  return useMemo(() => {
    if (!issue) return { boundShell: false, compactChannelChrome: false };
    // The project home, including a supporting-doc iframe, scrolls inside
    // the page so the reading area can fill.
    if (issue.kind === "project") {
      return { boundShell: true, compactChannelChrome: false };
    }
    const active = resolveIssueDetailTab(tabParam, tabs);
    const boundShell = issueDetailTabNeedsBoundedShell(active, tabs);
    return {
      boundShell,
      compactChannelChrome: mobileChannelChromeForTab(isMobile, active, tabs),
    };
  }, [issue, isMobile, tabParam, tabs]);
}

export function IssueDetailPage() {
  const { projectId = "", id = "" } = useParams();
  const location = useLocation();

  const { data: issue, isLoading, error } = useIssueDetailQuery(id);
  const { data: list } = useIssuesWithArchived(
    Boolean(issue && isArchived(issue)),
  );
  const { byId, missingIds, accept, reject } = useSupplementedById(
    issue ? [issue.id] : [],
    issue,
    list?.issues,
    true,
  );

  const catalog = useMemo(
    () => projectCatalogLabels(byId, projectId),
    [byId, projectId],
  );

  const parentKind = useMemo(
    () => (issue ? parentKindForIssue(issue, projectId, byId) : undefined),
    [issue, projectId, byId],
  );

  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const detailTabs = useMemo(
    () => (issue ? tabsForIssueDetail(issue, parentKind) : []),
    [issue, parentKind],
  );
  const { boundShell, compactChannelChrome } = useIssueDetailShellFlags(
    issue,
    detailTabs,
    tabParam,
  );
  useTabTitle(
    tabTitleEntityName(issue?.title, id),
    id === projectId
      ? projectHomeTitleSuffix(tabParam)
      : issueDetailTabTitleSuffix(tabParam, issue ? detailTabs : undefined),
  );

  const missing = error instanceof ApiError && error.status === 404;
  const wrongProject =
    Boolean(list) && Boolean(issue) && !issueBelongsToProject(id, projectId, byId);
  const showScopeError = missing || wrongProject;
  // Gate only on the detail query. Waiting on the issues list kept hard
  // navigations on bare skeletons until the slower list settled.
  const loading = isLoading && !issue;

  const issueBackStack = (location.state as IssueBackLocationState | null)
    ?.issueBackStack;
  const backEntry = peekIssueBack(issueBackStack);
  const backTo = backEntry ? issueBackTo(backEntry) : projectPath(projectId);

  const backLink = (
    <Link
      to={backTo}
      state={{ issueBackStack: popIssueBack(issueBackStack) }}
      className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      Back
    </Link>
  );

  const ancestorReads =
    missingIds.length > 0 ? (
      <MissingIssueRecords
        ids={missingIds}
        onRecord={accept}
        onMissing={reject}
      />
    ) : null;

  if (issue?.kind === "review" && !showScopeError) {
    return <Navigate to={reviewIssuePath(projectId, issue.id)} replace />;
  }

  if (issue && !showScopeError && supportsAttachments(issue.kind)) {
    return (
      <>
      {ancestorReads}
      <IssueDetailAttachable
        issue={issue}
        projectId={projectId}
        backLink={backLink}
        catalog={catalog}
        parentKind={parentKind}
        tabs={detailTabs}
        boundShell={boundShell}
        compactChannelChrome={compactChannelChrome}
      />
      </>
    );
  }

  return (
    <>
    {ancestorReads}
    <PageShell
      className={cn(
        boundShell && BOUNDED_DETAIL_SHELL_CLASS,
        compactChannelChrome && "gap-0 px-0 py-0",
      )}
    >
      {compactChannelChrome ? null : (
        <div data-testid="issue-detail-back">{backLink}</div>
      )}

      {error && !missing ? (
        <ShellInlineFault
          message={error.message}
          hint="Check the server, then reload."
        />
      ) : null}

      {loading ? <ShellLoadingState label="Loading issue…" /> : null}

      {showScopeError && !loading ? (
        <ShellState
          tone="blocked"
          eyebrow="Missing"
          title={
            missing ? "No issue with that id." : "That issue lives elsewhere."
          }
          detail={
            missing ? (
              <ShellFaultDetail
                message={id}
                hint="Check the id, or pick the issue from the project tree."
              />
            ) : (
              <ShellFaultDetail
                message={`${id} is not under ${projectId}`}
                hint="Open it from its own project, or check the id."
              />
            )
          }
        />
      ) : null}

      {issue && !showScopeError ? (
        <IssueDetailBody
          issue={issue}
          catalog={catalog}
          projectId={projectId}
          parentKind={parentKind}
          tabs={detailTabs}
          compactChannelChrome={compactChannelChrome}
        />
      ) : null}
    </PageShell>
    </>
  );
}
