import { useMemo, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import type { IssueDetail, ProjectLabel } from "@server/schemas";
import { ApiError } from "@/lib/api/errors";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils/cn";
import { useIssueDetailQuery, useIssuesQuery } from "../api/queries";
import { useUploadAttachment } from "../api/mutations";
import {
  useIssueDetailFileUpload,
  type UploadAttachmentMutation,
} from "../hooks/use-issue-detail-file-upload";
import { kindHas } from "../lib/kind";
import { issueBelongsToProject, issuesById } from "../lib/build-tree";
import { projectPath } from "../lib/links";
import {
  parseChatCompanionState,
  writeChatCompanionParam,
} from "../lib/chat-companion";
import { kindHasOwnFlow } from "../lib/own-flow";
import {
  isLabelAssignableIssue,
  projectCatalogLabels,
} from "../lib/project-labels";
import { IssueMetaPanel } from "./issue-meta-panel";
import { IssueDetailHeader } from "./issue-detail-header";
import { GitStackPanel } from "./git-stack-panel";
import { StoryTaskRail } from "./story-task-rail";
import { EpicDepsPanel } from "./epic-deps-panel";
import { IssueAttachmentsSection } from "./attachments-panel";
import { IssueDescriptionField } from "./issue-description-field";
import { IssueAssignmentLabelsField } from "./issue-assignment-labels-field";
import { IssueProjectLabelsField } from "./issue-project-labels-field";
import { IssueSupportingDocsField } from "./issue-supporting-docs-field";
import { IssueInspirationAppsField } from "./issue-inspiration-apps-field";
import { ChatPanel } from "./chat-panel";
import { DetailEyebrow } from "./detail-section";
import { ProjectDetailTabs } from "./project-detail-tabs";
import { supportsAttachments } from "../lib/attachments";

const DETAIL_PAGE_SHELL_CLASS = "max-w-6xl";

/**
 * Own-flow area for `surfaces-detail-flow`. Story: single-spine task Rail.
 * Epic: dependency neighborhood DAG + blockedBy edit. Idea / Task / Project
 * leave the slot empty.
 */
function OwnFlowSlot({ issue }: { issue: IssueDetail }) {
  if (!kindHasOwnFlow(issue.kind)) return null;
  return (
    <div data-region="own-flow">
      {issue.kind === "story" ? <StoryTaskRail issue={issue} /> : null}
      {issue.kind === "epic" ? <EpicDepsPanel issue={issue} /> : null}
    </div>
  );
}

/** Docked companion for `surfaces-chat`; collapse persisted as `?chat=`. */
function CompanionSlot({
  issueId,
  attachmentsIssueId,
  expanded,
  onExpandedChange,
}: {
  issueId: string;
  attachmentsIssueId?: string;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
  return (
    <aside
      data-region="companion"
      data-state={expanded ? "expanded" : "collapsed"}
      className={cn(
        "flex shrink-0 flex-col border-l border-border",
        expanded
          ? "sticky top-8 h-[calc(100svh-4rem)] w-80 pl-4"
          : "w-10 items-center pt-1",
      )}
    >
      {expanded ? (
        <>
          <div className="flex items-center justify-between gap-2 pb-3">
            <DetailEyebrow>Chat</DetailEyebrow>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              title="Collapse chat"
              aria-label="Collapse chat"
              aria-expanded={true}
              onClick={() => onExpandedChange(false)}
            >
              <PanelRightClose className="h-4 w-4" />
            </Button>
          </div>
          <ChatPanel
            id={issueId}
            attachmentsIssueId={attachmentsIssueId}
          />
        </>
      ) : (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="Expand chat"
            aria-label="Expand chat"
            aria-expanded={false}
            onClick={() => onExpandedChange(true)}
          >
            <PanelRightOpen className="h-4 w-4" />
          </Button>
          <MessageSquare className="mt-2 h-3.5 w-3.5 text-muted-foreground" />
        </>
      )}
    </aside>
  );
}

function IssueDetailBody({
  issue,
  projectId,
  upload,
  catalog,
}: {
  issue: IssueDetail;
  projectId: string;
  upload?: UploadAttachmentMutation;
  catalog: ProjectLabel[];
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const attach = supportsAttachments(issue.kind);
  const companionExpanded =
    parseChatCompanionState(searchParams.get("chat")) === "expanded";

  const setCompanionExpanded = (expanded: boolean) => {
    setSearchParams(
      (prev) =>
        writeChatCompanionParam(prev, expanded ? "expanded" : "collapsed"),
      { replace: true },
    );
  };

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <IssueDetailHeader
          issue={issue}
          projectId={projectId}
          catalog={catalog}
        />

        <IssueDetailView
          issue={issue}
          catalog={catalog}
          upload={upload}
        />
      </div>

      {kindHas(issue.kind, "chat") ? (
        <CompanionSlot
          issueId={issue.id}
          attachmentsIssueId={attach ? issue.id : undefined}
          expanded={companionExpanded}
          onExpandedChange={setCompanionExpanded}
        />
      ) : null}
    </div>
  );
}

function IssueDetailView({
  issue,
  catalog,
  upload,
}: {
  issue: IssueDetail;
  catalog: ProjectLabel[];
  upload?: UploadAttachmentMutation;
}) {
  const overview = (
    <>
      <IssueMetaPanel issue={issue} />
      {issue.kind === "project" ? (
        <IssueProjectLabelsField issue={issue} />
      ) : null}
      {isLabelAssignableIssue(issue) ? (
        <IssueAssignmentLabelsField issue={issue} catalog={catalog} />
      ) : null}
      {issue.kind === "story" || issue.kind === "task" ? (
        <GitStackPanel issue={issue} />
      ) : null}
      <OwnFlowSlot issue={issue} />
      <IssueAttachmentsSection issue={issue} upload={upload} />
      <IssueDescriptionField issue={issue} upload={upload} />
      {issue.kind === "project" ? (
        <>
          <IssueSupportingDocsField issue={issue} />
          <IssueInspirationAppsField issue={issue} />
        </>
      ) : null}
    </>
  );

  if (issue.kind !== "project") {
    return overview;
  }

  return (
    <ProjectDetailTabs
      projectId={issue.id}
      supportingDocs={issue.supportingDocs}
      overview={overview}
    />
  );
}

/** Owns the shared upload mutation + page drop/paste target for attachable issues. */
function IssueDetailAttachable({
  issue,
  projectId,
  backLink,
  catalog,
}: {
  issue: IssueDetail;
  projectId: string;
  backLink: ReactNode;
  catalog: ProjectLabel[];
}) {
  const upload = useUploadAttachment(issue.id);
  const { rootProps } = useIssueDetailFileUpload(upload);

  return (
    <PageShell className={DETAIL_PAGE_SHELL_CLASS} {...rootProps}>
      {backLink}
      <IssueDetailBody
        issue={issue}
        projectId={projectId}
        upload={upload}
        catalog={catalog}
      />
    </PageShell>
  );
}

export function IssueDetailPage() {
  const { projectId = "", id = "" } = useParams();

  const { data: issue, isLoading, error } = useIssueDetailQuery(id);
  const { data: list, isLoading: listLoading } = useIssuesQuery();

  const byId = useMemo(
    () => issuesById(list?.issues ?? []),
    [list?.issues],
  );

  const catalog = useMemo(
    () => projectCatalogLabels(byId, projectId),
    [byId, projectId],
  );

  const missing = error instanceof ApiError && error.status === 404;
  const wrongProject =
    Boolean(list) && Boolean(issue) && !issueBelongsToProject(id, projectId, byId);
  const showScopeError = missing || wrongProject;
  const loading = isLoading || (Boolean(issue) && listLoading);

  const backLink = (
    <Link
      to={projectPath(projectId)}
      className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to tree
    </Link>
  );

  if (
    issue &&
    !showScopeError &&
    !loading &&
    supportsAttachments(issue.kind)
  ) {
    return (
      <IssueDetailAttachable
        issue={issue}
        projectId={projectId}
        backLink={backLink}
        catalog={catalog}
      />
    );
  }

  return (
    <PageShell className={DETAIL_PAGE_SHELL_CLASS}>
      {backLink}

      {error && !missing ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive-foreground">
          {error.message}
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : null}

      {showScopeError && !loading ? (
        <div className="rounded-lg border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
          {missing ? (
            <>
              No issue with id <span className="font-mono">{id}</span>.
            </>
          ) : (
            <>
              Issue <span className="font-mono">{id}</span> is not under project{" "}
              <span className="font-mono">{projectId}</span>.
            </>
          )}
        </div>
      ) : null}

      {issue && !showScopeError ? (
        <IssueDetailBody
          issue={issue}
          projectId={projectId}
          catalog={catalog}
        />
      ) : null}
    </PageShell>
  );
}
