import { useState } from "react";
import { useParams } from "react-router-dom";
import { GitBranchPlus, MessageSquarePlus } from "lucide-react";
import type { IssueDetail } from "@server/schemas";
import { Button } from "@/components/ui/button";
import { useUpdateFromMergeBase } from "../api/mutations";
import { useIssuesQuery } from "../api/queries";
import { useCreateAppendIdea } from "../lib/use-create-append-idea";
import {
  ADD_IDEA_HELPER,
  appendIdeaTitle,
  hasOpenUpdateFromMergeBaseTask,
  mergeBaseHelper,
  storyAppendAvailability,
} from "../lib/story-append-actions";
import { SettingsCard } from "./detail-section";
import { MergeBaseConfirmDialog } from "./merge-base-confirm-dialog";

type StoryDetail = Extract<IssueDetail, { kind: "story" }>;

function ActionCopy({
  id,
  children,
}: {
  id: string;
  children: string;
}) {
  return (
    <p
      id={id}
      data-testid={id}
      className="max-w-[52ch] text-sm leading-relaxed text-muted-foreground"
    >
      {children}
    </p>
  );
}

export function StoryAppendActionsCard({ issue }: { issue: StoryDetail }) {
  const { projectId = "" } = useParams();
  const { data } = useIssuesQuery();
  const { createAppendIdea, isPending: appendIdeaPending } = useCreateAppendIdea(projectId);
  const updateFromMergeBase = useUpdateFromMergeBase(issue.id);
  const availability = storyAppendAvailability({
    merged: issue.merged,
    branchName: issue.branchName,
    hasOpenMergeBaseTask: hasOpenUpdateFromMergeBaseTask(
      data?.issues ?? [],
      issue.id,
    ),
  });
  const mergeBase = data?.derived[issue.id]?.mergeBase;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const pending = appendIdeaPending || updateFromMergeBase.isPending;

  const addIdea = () => {
    if (!availability.ideaEnabled || pending || !projectId) return;
    void createAppendIdea(issue.id, appendIdeaTitle(issue.title));
  };

  const openMergeBaseConfirm = () => {
    if (
      !availability.mergeBaseEnabled ||
      pending ||
      !issue.branchName ||
      !mergeBase
    )
      return;
    setConfirmOpen(true);
  };

  const confirmMergeBase = () => {
    if (!availability.mergeBaseEnabled || pending) return;
    setConfirmOpen(false);
    updateFromMergeBase.mutate();
  };

  const ideaDescribedBy = availability.ideaEnabled
    ? "story-append-idea-helper"
    : availability.cardReason
      ? "story-append-card-reason"
      : undefined;
  const mergeBaseDescribedBy = availability.mergeBaseEnabled
    ? "story-append-merge-base-helper"
    : availability.mergeBaseReason
      ? "story-append-merge-base-reason"
      : availability.cardReason
        ? "story-append-card-reason"
        : undefined;

  return (
    <SettingsCard title="Append work" data-testid="story-append-actions-card">
      {availability.cardReason ? (
        <p
          id="story-append-card-reason"
          data-testid="story-append-card-reason"
          className="mb-3 max-w-[52ch] text-sm leading-relaxed text-muted-foreground"
        >
          {availability.cardReason}
        </p>
      ) : null}
      <div className="flex flex-col items-start gap-4">
        <div className="flex flex-col items-start gap-1.5">
          <Button
            type="button"
            variant="default"
            size="sm"
            className="w-fit"
            data-testid="story-append-add-idea"
            disabled={!availability.ideaEnabled || pending}
            aria-describedby={ideaDescribedBy}
            onClick={addIdea}
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            Add idea to append
          </Button>
          {availability.ideaEnabled ? (
            <ActionCopy id="story-append-idea-helper">{ADD_IDEA_HELPER}</ActionCopy>
          ) : null}
        </div>
        <div className="flex flex-col items-start gap-1.5">
          <Button
            type="button"
            variant="default"
            size="sm"
            className="w-fit"
            data-testid="story-append-update-merge-base"
            disabled={!availability.mergeBaseEnabled || pending}
            aria-describedby={mergeBaseDescribedBy}
            onClick={openMergeBaseConfirm}
          >
            <GitBranchPlus className="h-3.5 w-3.5" />
            Update from merge base
          </Button>
          {availability.mergeBaseEnabled && issue.branchName && mergeBase ? (
            <ActionCopy id="story-append-merge-base-helper">
              {mergeBaseHelper(mergeBase, issue.branchName)}
            </ActionCopy>
          ) : null}
          {availability.mergeBaseReason ? (
            <ActionCopy id="story-append-merge-base-reason">
              {availability.mergeBaseReason}
            </ActionCopy>
          ) : null}
        </div>
      </div>
      {issue.branchName && mergeBase ? (
        <MergeBaseConfirmDialog
          open={confirmOpen}
          mergeBase={mergeBase}
          branchName={issue.branchName}
          onOpenChange={setConfirmOpen}
          onConfirm={confirmMergeBase}
        />
      ) : null}
    </SettingsCard>
  );
}
