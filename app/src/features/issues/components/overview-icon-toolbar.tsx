import { type ReactNode, useState } from "react";
import { useParams } from "react-router-dom";
import { GitBranchPlus, MessageSquarePlus } from "lucide-react";
import type { IssueDetail, IssueKind } from "@server/schemas";
import { Button } from "@/components/ui/button";
import {
  isImplementingWorkRoot,
  type ImplementingWorkRoot,
} from "@server/services/implementing-launch";
import { useUpdateFromMergeBase } from "../api/mutations";
import { useIssuesQuery } from "../api/queries";
import { useCreateFollowUpIdea } from "../lib/use-create-follow-up-idea";
import {
  followUpIdeaTitle,
  hasOpenUpdateFromMergeBaseTask,
  storyAppendActions,
} from "../lib/story-append-actions";
import type { OverviewWorkLoopAction } from "../lib/overview-work-loop-action";
import { overviewQueueToolbarSkipped } from "../lib/overview-implementing-work-loop";
import { AmendOutlineControl } from "./amend-outline-control";
import { MergeBaseConfirmDialog } from "./merge-base-confirm-dialog";
import { ParkedResumeControl } from "./queue-park-control";
import {
  QueueWorkButton,
  ResumeWorkLoopIconButton,
  useImplementingOverviewWorkLoop,
} from "./implementing-launch-control";

type StoryDetail = Extract<IssueDetail, { kind: "story" }>;

function OverviewActionsToolbarShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      data-testid="overview-icon-toolbar"
      role="toolbar"
      aria-label="Overview actions"
    >
      {children}
    </div>
  );
}

function OverviewQueueToolbarButtons({
  issue,
  sessionsLoading,
  workLoopAction,
  assumeVisible,
}: {
  issue: ImplementingWorkRoot;
  sessionsLoading: boolean;
  workLoopAction: OverviewWorkLoopAction;
  /** Parent already ensured sessions are loaded and the action is not hidden. */
  assumeVisible?: boolean;
}) {
  if (
    !assumeVisible &&
    overviewQueueToolbarSkipped(sessionsLoading, workLoopAction)
  ) {
    return null;
  }

  if (workLoopAction.action === "unpark") {
    return (
      <ParkedResumeControl
        issueId={issue.id}
        testId="overview-icon-toolbar-parked-resume"
      />
    );
  }

  if (workLoopAction.action === "queue") {
    return (
      <QueueWorkButton
        issue={issue}
        optimistic
        testId="overview-icon-toolbar-queue"
      />
    );
  }

  if (workLoopAction.action === "resume") {
    return (
      <ResumeWorkLoopIconButton
        issue={issue}
        resumeSession={workLoopAction.resumeSession}
        testId="overview-icon-toolbar-resume-work-loop"
      />
    );
  }

  return null;
}

function StoryOverviewQueueSlot({
  issue,
  parentKind,
}: {
  issue: StoryDetail;
  parentKind?: IssueKind;
}) {
  const { sessionsLoading, workLoopAction } = useImplementingOverviewWorkLoop(
    issue,
    parentKind,
  );
  return (
    <OverviewQueueToolbarButtons
      issue={issue}
      sessionsLoading={sessionsLoading}
      workLoopAction={workLoopAction}
    />
  );
}

function EpicOverviewIconToolbar({ issue }: { issue: ImplementingWorkRoot }) {
  const { sessionsLoading, workLoopAction } = useImplementingOverviewWorkLoop(
    issue,
    undefined,
  );

  if (overviewQueueToolbarSkipped(sessionsLoading, workLoopAction)) {
    return null;
  }

  return (
    <OverviewActionsToolbarShell>
      <OverviewQueueToolbarButtons
        issue={issue}
        sessionsLoading={sessionsLoading}
        workLoopAction={workLoopAction}
        assumeVisible
      />
    </OverviewActionsToolbarShell>
  );
}

function StoryOverviewIconToolbar({
  issue,
  parentKind,
}: {
  issue: StoryDetail;
  parentKind?: IssueKind;
}) {
  const { projectId = "" } = useParams();
  const { data } = useIssuesQuery();
  const { createFollowUpIdea, isPending: followUpPending } =
    useCreateFollowUpIdea(projectId);
  const updateFromMergeBase = useUpdateFromMergeBase(issue.id);

  const append = storyAppendActions({
    merged: issue.merged,
    branchName: issue.branchName,
    sourceOutline: issue.sourceOutline,
    hasOpenMergeBaseTask: hasOpenUpdateFromMergeBaseTask(
      data?.issues ?? [],
      issue.id,
    ),
  });
  const mergeBase = data?.derived[issue.id]?.mergeBase;
  const [confirmOpen, setConfirmOpen] = useState(false);

  const queueCandidate =
    isImplementingWorkRoot("implementing", issue, parentKind) && !issue.merged;

  const showToolbar =
    queueCandidate ||
    append.addIdea ||
    append.amendOutline ||
    append.updateFromMergeBase;

  const addIdea = () => {
    if (!append.addIdea || followUpPending || !projectId) return;
    void createFollowUpIdea(followUpIdeaTitle(issue.title));
  };

  const openMergeBaseConfirm = () => {
    if (
      updateFromMergeBase.isPending ||
      !issue.branchName ||
      !mergeBase
    ) {
      return;
    }
    setConfirmOpen(true);
  };

  const confirmMergeBase = () => {
    if (updateFromMergeBase.isPending) return;
    setConfirmOpen(false);
    updateFromMergeBase.mutate();
  };

  if (!showToolbar) {
    return null;
  }

  const addIdeaButtonLabel = followUpPending
    ? "Adding idea…"
    : "Follow-up idea";
  const mergeBaseButtonLabel = updateFromMergeBase.isPending
    ? "Updating…"
    : "Update from merge base";

  return (
    <OverviewActionsToolbarShell>
      {queueCandidate ? (
        <StoryOverviewQueueSlot issue={issue} parentKind={parentKind} />
      ) : null}
      {append.addIdea ? (
        <Button
          type="button"
          variant="default"
          size="icon-sm"
          title={addIdeaButtonLabel}
          aria-label={addIdeaButtonLabel}
          aria-busy={followUpPending || undefined}
          data-testid={
            followUpPending
              ? "overview-icon-toolbar-add-idea-pending"
              : "overview-icon-toolbar-add-idea"
          }
          disabled={followUpPending}
          onClick={addIdea}
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
        </Button>
      ) : null}
      {append.amendOutline && issue.sourceOutline ? (
        <AmendOutlineControl
          projectId={projectId}
          storyId={issue.id}
          outlineId={issue.sourceOutline.outline}
          trigger={(openDialog) => (
            <Button
              type="button"
              variant="default"
              size="icon-sm"
              title="Amend outline"
              aria-label="Amend outline"
              data-testid="overview-icon-toolbar-amend-outline"
              onClick={openDialog}
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
            </Button>
          )}
        />
      ) : null}
      {append.updateFromMergeBase && issue.branchName && mergeBase ? (
        <>
          <Button
            type="button"
            variant="default"
            size="icon-sm"
            title={mergeBaseButtonLabel}
            aria-label={mergeBaseButtonLabel}
            aria-busy={updateFromMergeBase.isPending || undefined}
            data-testid={
              updateFromMergeBase.isPending
                ? "overview-icon-toolbar-update-merge-base-pending"
                : "overview-icon-toolbar-update-merge-base"
            }
            disabled={updateFromMergeBase.isPending}
            onClick={openMergeBaseConfirm}
          >
            <GitBranchPlus className="h-3.5 w-3.5" />
          </Button>
          <MergeBaseConfirmDialog
            open={confirmOpen}
            mergeBase={mergeBase}
            branchName={issue.branchName}
            onOpenChange={setConfirmOpen}
            onConfirm={confirmMergeBase}
          />
        </>
      ) : null}
    </OverviewActionsToolbarShell>
  );
}

export function OverviewIconToolbar({
  issue,
  parentKind,
}: {
  issue: IssueDetail;
  parentKind?: IssueKind;
}) {
  if (issue.kind === "story") {
    return (
      <StoryOverviewIconToolbar issue={issue} parentKind={parentKind} />
    );
  }
  if (issue.kind === "epic") {
    return <EpicOverviewIconToolbar issue={issue} />;
  }
  return null;
}
