import { useMemo, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
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
import { useIssueDetailQuery, useIssuesQuery } from "../api/queries";
import { useUploadAttachment } from "../api/mutations";
import {
  useIssueDetailFileUpload,
  type UploadAttachmentMutation,
} from "../hooks/use-issue-detail-file-upload";
import { kindHasOwnFlow } from "../lib/own-flow";
import { issueBelongsToProject, issuesById } from "../lib/build-tree";
import {
  issueDetailTabNeedsBoundedShell,
  resolveIssueDetailTab,
  tabsForIssueDetail,
} from "../lib/issue-detail-tabs";
import { projectPath } from "../lib/links";
import { projectCatalogLabels } from "../lib/project-labels";
import { IssueMetaPanel } from "./issue-meta-panel";
import { IssueDetailHeader } from "./issue-detail-header";
import { IssueDetailTabs } from "./issue-detail-tabs";
import { StoryTaskRail } from "./story-task-rail";
import { EpicStoryRail } from "./epic-story-rail";
import { IssueAttachmentsSection } from "./attachments-panel";
import { IssueDescriptionField } from "./issue-description-field";
import { IssueCommentsSection } from "./comments/comments-section";
import { ProjectSettingsOverview } from "./project-settings-overview";
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

function IssueOverviewPanel({
  issue,
  upload,
  catalog,
}: {
  issue: IssueDetail;
  upload?: UploadAttachmentMutation;
  catalog: ProjectLabel[];
}) {
  if (issue.kind === "project") {
    return <ProjectSettingsOverview issue={issue} upload={upload} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <IssueMetaPanel issue={issue} catalog={catalog} />
      <OwnFlowSlot issue={issue} />
      <IssueAttachmentsSection issue={issue} upload={upload} />
      <IssueDescriptionField issue={issue} upload={upload} />
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
  compactChannelChrome,
}: {
  issue: IssueDetail;
  upload?: UploadAttachmentMutation;
  catalog: ProjectLabel[];
  projectId: string;
  parentKind?: IssueKind;
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

      <IssueDetailTabs
        issue={issue}
        projectId={projectId}
        parentKind={parentKind}
        overview={
          <IssueOverviewPanel
            issue={issue}
            upload={upload}
            catalog={catalog}
          />
        }
      />
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
  boundShell,
  compactChannelChrome,
}: {
  issue: IssueDetail;
  projectId: string;
  backLink: ReactNode;
  catalog: ProjectLabel[];
  parentKind?: IssueKind;
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
        compactChannelChrome={compactChannelChrome}
      />
    </PageShell>
  );
}

function useIssueDetailShellFlags(
  issue: IssueDetail | undefined,
  parentKind?: IssueKind,
): { boundShell: boolean; compactChannelChrome: boolean } {
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const isMobile = useIsMobile();
  return useMemo(() => {
    if (!issue) return { boundShell: false, compactChannelChrome: false };
    // Project docs (esp. Design system iframe) need a bounded shell so the
    // reading area can fill and scroll internally.
    if (issue.kind === "project") {
      return { boundShell: true, compactChannelChrome: false };
    }
    const tabs = tabsForIssueDetail(issue, parentKind);
    const active = resolveIssueDetailTab(tabParam, tabs);
    const boundShell = issueDetailTabNeedsBoundedShell(active, tabs);
    return {
      boundShell,
      compactChannelChrome: isMobile && boundShell,
    };
  }, [issue, parentKind, tabParam, isMobile]);
}

export function IssueDetailPage() {
  const { projectId = "", id = "" } = useParams();

  const { data: issue, isLoading, error } = useIssueDetailQuery(id);
  const { data: list } = useIssuesQuery();

  const byId = useMemo(
    () => issuesById(list?.issues ?? []),
    [list?.issues],
  );

  const catalog = useMemo(
    () => projectCatalogLabels(byId, projectId),
    [byId, projectId],
  );

  const parentKind = useMemo(
    () => (issue ? parentKindForIssue(issue, projectId, byId) : undefined),
    [issue, projectId, byId],
  );

  const { boundShell, compactChannelChrome } = useIssueDetailShellFlags(
    issue,
    parentKind,
  );

  const missing = error instanceof ApiError && error.status === 404;
  const wrongProject =
    Boolean(list) && Boolean(issue) && !issueBelongsToProject(id, projectId, byId);
  const showScopeError = missing || wrongProject;
  // Gate only on the detail query. Waiting on the issues list kept hard
  // navigations on bare skeletons until the slower list settled.
  const loading = isLoading && !issue;

  const backLink = (
    <Link
      to={projectPath(projectId)}
      className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to tree
    </Link>
  );

  if (issue && !showScopeError && supportsAttachments(issue.kind)) {
    return (
      <IssueDetailAttachable
        issue={issue}
        projectId={projectId}
        backLink={backLink}
        catalog={catalog}
        parentKind={parentKind}
        boundShell={boundShell}
        compactChannelChrome={compactChannelChrome}
      />
    );
  }

  return (
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
          compactChannelChrome={compactChannelChrome}
        />
      ) : null}
    </PageShell>
  );
}
