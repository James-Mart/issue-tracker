import { useMemo, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, MessageSquare, PanelRightClose } from "lucide-react";
import type { IssueDetail, ProjectLabel } from "@server/schemas";
import { ApiError } from "@/lib/api/errors";
import { ShellLoadingState } from "@/app/shell-state";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import {
  useChatQuery,
  useIssueDetailQuery,
  useIssuesQuery,
} from "../api/queries";
import { useUploadAttachment } from "../api/mutations";
import {
  useIssueDetailFileUpload,
  type UploadAttachmentMutation,
} from "../hooks/use-issue-detail-file-upload";
import { kindHasOwnFlow } from "../lib/own-flow";
import { issueBelongsToProject, issuesById } from "../lib/build-tree";
import { projectPath } from "../lib/links";
import {
  parseChatCompanionPreference,
  resolveChatCompanionExpanded,
  showsChatCompanion,
  writeChatCompanionParam,
} from "../lib/chat-companion";
import { isInFlight } from "../lib/derived";
import { projectCatalogLabels } from "../lib/project-labels";
import { IssueMetaPanel } from "./issue-meta-panel";
import { IssueDetailHeader } from "./issue-detail-header";
import { StoryTaskRail } from "./story-task-rail";
import { EpicStoryRail } from "./epic-story-rail";
import { IssueAttachmentsSection } from "./attachments-panel";
import { IssueDescriptionField } from "./issue-description-field";
import { IssueSupportingDocsField } from "./issue-supporting-docs-field";
import { IssueInspirationAppsField } from "./issue-inspiration-apps-field";
import { ChatPanel } from "./chat-panel";
import { DetailEyebrow } from "./detail-section";
import { ProjectDetailTabs } from "./project-detail-tabs";
import { supportsAttachments } from "../lib/attachments";

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

/** Docked companion for `surfaces-chat`; collapse override as `?chat=`. */
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
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="Steer this issue"
          aria-label="Steer this issue"
          aria-expanded={false}
          onClick={() => onExpandedChange(true)}
        >
          <MessageSquare className="h-4 w-4" />
        </Button>
      )}
    </aside>
  );
}

/** Owns chat fetch + `?chat=` companion state; mount only when the companion shows. */
function IssueDetailCompanion({ issue }: { issue: IssueDetail }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: chat } = useChatQuery(issue.id);
  const attach = supportsAttachments(issue.kind);
  const preference = parseChatCompanionPreference(searchParams.get("chat"));
  const hasMessages = (chat?.messages.length ?? 0) > 0;
  const companionExpanded = resolveChatCompanionExpanded(preference, {
    hasMessages,
    agentLive: isInFlight(issue),
  });

  const setCompanionExpanded = (expanded: boolean) => {
    setSearchParams(
      (prev) =>
        writeChatCompanionParam(prev, expanded ? "expanded" : "collapsed"),
      { replace: true },
    );
  };

  return (
    <CompanionSlot
      issueId={issue.id}
      attachmentsIssueId={attach ? issue.id : undefined}
      expanded={companionExpanded}
      onExpandedChange={setCompanionExpanded}
    />
  );
}

function IssueDetailBody({
  issue,
  upload,
  catalog,
}: {
  issue: IssueDetail;
  upload?: UploadAttachmentMutation;
  catalog: ProjectLabel[];
}) {
  return (
    <div className="flex min-h-0 flex-1 gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <IssueDetailHeader issue={issue} catalog={catalog} />

        <IssueDetailView
          issue={issue}
          catalog={catalog}
          upload={upload}
        />
      </div>

      {showsChatCompanion(issue.kind) ? (
        <IssueDetailCompanion issue={issue} />
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
      <IssueMetaPanel issue={issue} catalog={catalog} />
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
    <PageShell {...rootProps}>
      {backLink}
      <IssueDetailBody issue={issue} upload={upload} catalog={catalog} />
    </PageShell>
  );
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
      />
    );
  }

  return (
    <PageShell>
      {backLink}

      {error && !missing ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive-foreground">
          {error.message}
        </div>
      ) : null}

      {loading ? <ShellLoadingState label="Loading issue…" /> : null}

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
        <IssueDetailBody issue={issue} catalog={catalog} />
      ) : null}
    </PageShell>
  );
}
