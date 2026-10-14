import { useMemo } from "react";
import { ChevronRight, Loader2, RotateCcw } from "lucide-react";
import type { ReviewSubmission } from "@server/schemas";
import { ShellInlineFault, ShellState } from "@/app/shell-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { commentDayLabel } from "@/features/issues/components/comments/marker";
import type { CommentThread } from "@/features/issues/lib/comment-threads";
import { useRetryStandardsAssessment } from "../api/mutations";
import { useReviewCommentThreads } from "../hooks/use-review-comments";
import {
  showSubmittedGroupsLabel,
  standardsDocFileName,
  standardsGroupEditable,
  standardsGroups,
  type StandardsGroup,
} from "../lib/review-standards-ui";
import { StandardsProposalCard } from "./review-standards-proposal";

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

function AssessFailed({
  projectId,
  reviewId,
  group,
}: {
  projectId: string;
  reviewId: string;
  group: StandardsGroup;
}) {
  const retry = useRetryStandardsAssessment(projectId);
  return (
    <ShellInlineFault
      className="text-[hsl(var(--blocked))]"
      message={group.standards.error ?? "Standards assessment failed."}
      hint="Check the coding-standards doc, then retry."
      action={
        <Button
          type="button"
          size="sm"
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

type GroupProps = {
  projectId: string;
  reviewId: string;
  group: StandardsGroup;
  threadsById: ReadonlyMap<string, CommentThread>;
  threadSearch: (threadId: string) => string;
};

function StandardsGroupBody({ projectId, reviewId, group, threadsById, threadSearch }: GroupProps) {
  const { standards } = group;
  switch (standards.status) {
    case "assessing":
      return null;
    case "assessFailed":
      return <AssessFailed projectId={projectId} reviewId={reviewId} group={group} />;
    case "noGaps":
      return <ShellState title="No coding-standards gaps found." />;
    default: {
      const editable = standardsGroupEditable(standards);
      const docFileName = standardsDocFileName(standards.doc);
      return standards.proposals.map((proposal) => (
        <StandardsProposalCard
          key={proposal.id}
          projectId={projectId}
          reviewId={reviewId}
          submissionId={group.submissionId}
          docFileName={docFileName}
          proposal={proposal}
          editable={editable}
          threadsById={threadsById}
          threadSearch={threadSearch}
        />
      ));
    }
  }
}

function StandardsGroupSection(props: GroupProps) {
  const { group } = props;
  const { standards } = group;
  const headingId = `standards-group-${group.submissionId}`;
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
            Round {group.round}
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
}: {
  projectId: string;
  reviewId: string;
  submissions: readonly ReviewSubmission[];
  threadSearch: (threadId: string) => string;
}) {
  const { threads } = useReviewCommentThreads(reviewId);
  const threadsById = useMemo(
    () => new Map(threads.map((thread) => [thread.root.id, thread])),
    [threads],
  );
  const { open, submitted } = standardsGroups(submissions);
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
