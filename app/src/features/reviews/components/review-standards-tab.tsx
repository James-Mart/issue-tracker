import { useLayoutEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Loader2, RotateCcw } from "lucide-react";
import type { ReviewSubmission, StandardsAssessment } from "@server/schemas";
import { ShellInlineFault, ShellState } from "@/app/shell-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { commentDayLabel } from "@/features/issues/components/comments/marker";
import type { CommentThread } from "@/features/issues/lib/comment-threads";
import { supportingDocContentUrl } from "@/features/issues/lib/supporting-docs";
import { requestText } from "@/lib/api/client";
import { useRetryStandardsAssessment, useSubmitStandardsGroup } from "../api/mutations";
import { useReviewCommentThreads } from "../hooks/use-review-comments";
import {
  showSubmittedGroupsLabel,
  standardsDocFileName,
  standardsGroupEditable,
  standardsGroups,
  standardsSubmitState,
  type StandardsGroup,
} from "../lib/review-standards-ui";
import { StandardsProposalCard } from "./review-standards-proposal";
import {
  ReviewTranscriptLinkButton,
  useReviewTranscriptLinks,
} from "./review-transcript-link";

function GroupStatus({ status }: { status: StandardsGroup["standards"]["status"] }) {
  if (status === "assessing" || status === "applying") {
    return (
      <Badge variant="inProgress" className="shrink-0 gap-1.5" role="status" aria-live="polite">
        <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden />
        {status === "assessing" ? "Assessing…" : "Applying…"}
      </Badge>
    );
  }
  if (status === "applied") {
    return (
      <Badge variant="done" className="shrink-0">
        Submitted
      </Badge>
    );
  }
  return null;
}

/** A failed phase with its error; Retry re-runs that phase. */
function RetryFault({
  projectId,
  reviewId,
  group,
  fallback,
  hint,
  retryClassName,
}: {
  projectId: string;
  reviewId: string;
  group: StandardsGroup;
  fallback: string;
  hint: string;
  retryClassName?: string;
}) {
  const retry = useRetryStandardsAssessment(projectId);
  return (
    <ShellInlineFault
      className="text-[hsl(var(--blocked))]"
      message={group.standards.error ?? fallback}
      hint={hint}
      action={
        <Button
          type="button"
          size="sm"
          className={retryClassName}
          disabled={retry.isPending}
          data-testid="standards-retry"
          onClick={() => retry.mutate({ reviewId, submissionId: group.submissionId })}
        >
          <RotateCcw aria-hidden />
          Retry
        </Button>
      }
    />
  );
}

function StandardsSubmit({
  projectId,
  reviewId,
  group,
}: {
  projectId: string;
  reviewId: string;
  group: StandardsGroup;
}) {
  const submit = useSubmitStandardsGroup(projectId);
  const { disabled, reason } = standardsSubmitState(group.standards);
  const reasonId = `standards-submit-reason-${group.submissionId}`;
  return (
    <div className="flex flex-col items-start gap-2 border-t border-border px-1 pt-3">
      {reason ? (
        <p
          id={reasonId}
          className="text-xs text-[hsl(var(--blocked))]"
          data-testid="standards-submit-reason"
        >
          {reason}
        </p>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="primary"
        disabled={disabled || submit.isPending}
        aria-describedby={reason ? reasonId : undefined}
        data-testid="standards-submit"
        onClick={() => submit.mutate({ reviewId, submissionId: group.submissionId })}
      >
        Submit
      </Button>
    </div>
  );
}

type GroupProps = {
  projectId: string;
  reviewId: string;
  group: StandardsGroup;
  threadsById: ReadonlyMap<string, CommentThread>;
  threadSearch: (threadId: string) => string;
};

/** The standards file as it reads now, shared by every card in the round. */
function useStandardsFileText(projectId: string, doc: StandardsAssessment["doc"]) {
  const url = supportingDocContentUrl(projectId, doc);
  return useQuery({
    queryKey: ["standards-file-text", projectId, url],
    queryFn: () => requestText(url),
  });
}

function StandardsProposalList({
  projectId,
  reviewId,
  group,
  threadsById,
  threadSearch,
}: GroupProps) {
  const { standards } = group;
  const editable = standardsGroupEditable(standards);
  const docFileName = standardsDocFileName(standards.doc);
  const file = useStandardsFileText(projectId, standards.doc);
  const fileError = file.isError
    ? file.error instanceof Error
      ? file.error.message
      : "Couldn't load the standards file."
    : undefined;
  return standards.proposals.map((proposal) => (
    <StandardsProposalCard
      key={proposal.id}
      projectId={projectId}
      reviewId={reviewId}
      submissionId={group.submissionId}
      docFileName={docFileName}
      proposal={proposal}
      fileText={file.data}
      fileLoading={file.isLoading}
      fileError={fileError}
      editable={editable}
      threadsById={threadsById}
      threadSearch={threadSearch}
    />
  ));
}

function StandardsGroupBody(props: GroupProps) {
  const { projectId, reviewId, group } = props;
  switch (group.standards.status) {
    case "assessing":
      return null;
    case "assessFailed":
      return (
        <RetryFault
          projectId={projectId}
          reviewId={reviewId}
          group={group}
          fallback="Standards assessment failed."
          hint="Check the coding-standards doc, then retry."
        />
      );
    case "noGaps":
      return <ShellState title="No coding-standards gaps found." />;
    case "ready":
      return (
        <>
          <StandardsProposalList {...props} />
          <StandardsSubmit projectId={projectId} reviewId={reviewId} group={group} />
        </>
      );
    case "applying":
    case "applied":
      return <StandardsProposalList {...props} />;
    case "applyFailed":
      return (
        <>
          <StandardsProposalList {...props} />
          <RetryFault
            projectId={projectId}
            reviewId={reviewId}
            group={group}
            fallback="Applying the accepted edits failed."
            hint="Retry writes the accepted edits to the coding-standards doc."
            retryClassName="[color:hsl(var(--blocked))]"
          />
        </>
      );
  }
}

function StandardsGroupSection(props: GroupProps) {
  const { group } = props;
  const { standards } = group;
  const transcripts = useReviewTranscriptLinks();
  const assessorId = transcripts?.assessorConversationId(group.submissionId);
  const headingId = `standards-group-${group.submissionId}`;
  const title = `Round ${group.round}`;
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-2 border-b border-border py-3"
      data-testid="standards-group"
      data-submission-id={group.submissionId}
      data-status={standards.status}
    >
      <header className="flex items-start justify-between gap-2 px-1">
        <div className="min-w-0">
          <h3 id={headingId} className="truncate text-sm font-semibold text-foreground">
            {transcripts && assessorId ? (
              <ReviewTranscriptLinkButton
                testId="standards-round-transcript"
                className="truncate font-semibold"
                onClick={() => transcripts.openAssessor(group.submissionId, assessorId)}
              >
                {title}
              </ReviewTranscriptLinkButton>
            ) : (
              title
            )}
          </h3>
          <p className="font-mono text-[11px] text-muted-foreground">
            {commentDayLabel(group.at)}
            {standards.doc.type === "workspace" ? " · workspace" : null}
          </p>
        </div>
        <GroupStatus status={standards.status} />
      </header>
      <StandardsGroupBody {...props} />
    </section>
  );
}

/** Coding-standards proposals per assessed submission, with decisions and edits. */
export function ReviewStandardsTab({
  projectId,
  reviewId,
  submissions,
  threadSearch,
  focusSubmissionId = null,
  onSubmissionFocused,
}: {
  projectId: string;
  reviewId: string;
  submissions: readonly ReviewSubmission[];
  threadSearch: (threadId: string) => string;
  /** Round to open and scroll into view after an Agents card names it. */
  focusSubmissionId?: string | null;
  onSubmissionFocused?: () => void;
}) {
  const { threads } = useReviewCommentThreads(reviewId);
  const threadsById = useMemo(
    () => new Map(threads.map((thread) => [thread.root.id, thread])),
    [threads],
  );
  const { open, submitted } = standardsGroups(submissions);

  useLayoutEffect(() => {
    if (!focusSubmissionId) return;
    const heading = document.getElementById(`standards-group-${focusSubmissionId}`);
    const section = heading?.closest("section");
    if (!section) return;
    const details = section.closest("details");
    if (details instanceof HTMLDetailsElement) details.open = true;
    section.scrollIntoView({ block: "nearest" });
    onSubmissionFocused?.();
  }, [focusSubmissionId, onSubmissionFocused, submissions]);
  const section = (group: StandardsGroup) => (
    <StandardsGroupSection
      key={group.submissionId}
      projectId={projectId}
      reviewId={reviewId}
      group={group}
      threadsById={threadsById}
      threadSearch={threadSearch}
    />
  );

  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto px-1"
      data-testid="review-standards-tab"
    >
      {open.map(section)}
      {submitted.length > 0 ? (
        <details className="group">
          <summary
            data-testid="standards-submitted-toggle"
            className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 border-b border-border px-1 text-sm text-muted-foreground marker:content-none hover:text-foreground [&::-webkit-details-marker]:hidden"
          >
            <ChevronRight
              aria-hidden
              className="h-3.5 w-3.5 shrink-0 motion-safe:transition-transform group-open:rotate-90"
            />
            <span className="group-open:hidden">{showSubmittedGroupsLabel(submitted.length)}</span>
            <span className="hidden group-open:inline">Hide submitted groups</span>
          </summary>
          {submitted.map(section)}
        </details>
      ) : null}
    </div>
  );
}
