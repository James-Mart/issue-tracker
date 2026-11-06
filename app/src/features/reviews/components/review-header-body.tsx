import { useState, type ReactNode } from "react";
import { CircleAlert, GitBranch } from "lucide-react";
import { Link } from "react-router-dom";
import type { ReviewCommits, ReviewPrSource, ReviewView } from "@server/schemas";
import type { CommentThread } from "@/features/issues/lib/comment-threads";
import { CommentGitHubIcon } from "@/features/issues/components/comments/comment-github-icon";
import { useReviewCommentThreads } from "../hooks/use-review-comments";
import { issuePath } from "@/features/issues/lib/links";
import { shortSha } from "@/lib/utils/short-sha";
import { partitionSubmissionCommentThreads } from "../lib/review-submittable";
import {
  acknowledgedSubmissions,
  reviewSubmitHeader,
} from "../lib/review-submission-ui";
import { ReviewOpenThreads } from "./review-open-threads";
import { ReviewRuntimePanel } from "./review-runtime-panel";
import { ReviewSubmitActions } from "./review-submit-control";
import { ReviewTipSyncNotice } from "./review-tip-sync-notice";

const sourceLinkClass = "inline-flex items-center gap-1 hover:underline";

function ReviewStorySourceLink({
  projectId,
  storyId,
}: {
  projectId: string;
  storyId: string;
}) {
  return (
    <Link
      to={issuePath(projectId, storyId)}
      className={`${sourceLinkClass} text-primary`}
      data-testid="review-story-link"
    >
      <GitBranch className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{storyId}</span>
    </Link>
  );
}

function ReviewPrSourceLink({ pr }: { pr: ReviewPrSource }) {
  return (
    <a
      href={pr.url}
      target="_blank"
      rel="noreferrer"
      className={sourceLinkClass}
      data-testid="review-pr-link"
    >
      <CommentGitHubIcon />
      <span className="text-foreground">#{pr.number}</span>
    </a>
  );
}

/** Renders `baseRef` ← head (merge target then candidate). PR-only reviews show the PR head ref as plain text. */
function ReviewMergeRangeLine({
  projectId,
  storyId,
  storyBranchName,
  pr,
  commits,
}: {
  projectId: string;
  storyId: string;
  storyBranchName?: string;
  pr?: ReviewPrSource;
  commits: ReviewCommits;
}) {
  const baseRef = pr ? pr.baseRef : commits.mergeBaseRef;
  const prOnly = Boolean(pr) && !storyId;

  let head: ReactNode;
  if (prOnly && pr) {
    head = <span className="text-foreground">{pr.headRef}</span>;
  } else if (storyId) {
    head = (
      <Link
        to={issuePath(projectId, storyId)}
        className="text-primary hover:underline"
        data-testid="review-merge-range-head-link"
      >
        {storyBranchName ?? storyId}
      </Link>
    );
  } else {
    head = (
      <span className="text-foreground" title={commits.tip}>
        {shortSha(commits.tip)}
      </span>
    );
  }

  return (
    <span
      className="inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5"
      data-testid="review-merge-range"
    >
      <span className="text-foreground">{baseRef}</span>
      <span className="text-muted-foreground" aria-hidden>
        {"←"}
      </span>
      {head}
    </span>
  );
}

/** Open-thread expansion sits below failures so tasking errors stay fixed while the list grows. */
export function ReviewHeaderBody({
  projectId,
  storyId,
  storyBranchName,
  title,
  review,
  commits,
  merged,
  onOpenThread,
}: {
  projectId: string;
  storyId: string;
  /** Story git branch for the merge-range head; omitted for PR-only reviews. */
  storyBranchName?: string;
  title: string;
  review?: ReviewView;
  commits?: ReviewCommits;
  merged: boolean;
  onOpenThread?: (thread: CommentThread) => void;
}) {
  const { threads, loaded } = useReviewCommentThreads(review?.id ?? "");
  const submissions = review?.submissions ?? [];
  const submissionThreads = loaded
    ? partitionSubmissionCommentThreads(threads, submissions)
    : undefined;
  const readyCount = submissionThreads?.included.length;
  const [pendingThreadIds, setPendingThreadIds] = useState<string[] | undefined>();
  const [retryingIds, setRetryingIds] = useState<readonly string[] | undefined>();
  const header = review
    ? reviewSubmitHeader({
        merged,
        readyCount,
        submissions: acknowledgedSubmissions(
          review.submissions,
          pendingThreadIds,
          retryingIds,
        ),
      })
    : undefined;

  return (
    <>
      <div className="mt-1 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <h1 className="min-w-0 max-w-full text-xl font-semibold leading-snug tracking-tight text-foreground">
          {title}
        </h1>
        {review && header ? (
          <ReviewSubmitActions
            projectId={projectId}
            review={review}
            header={header}
            submissionThreads={submissionThreads}
            storyOpen={!merged}
            onAcknowledge={() =>
              setPendingThreadIds(submissionThreads?.included.map((thread) => thread.root.id))
            }
            onAcknowledgeEnd={() => setPendingThreadIds(undefined)}
            onRetryStart={setRetryingIds}
            onRetryEnd={() => setRetryingIds(undefined)}
          />
        ) : null}
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-xs tabular-nums text-muted-foreground">
        {review?.pr ? <ReviewPrSourceLink pr={review.pr} /> : null}
        {commits ? (
          <ReviewMergeRangeLine
            projectId={projectId}
            storyId={storyId}
            storyBranchName={storyBranchName}
            pr={review?.pr}
            commits={commits}
          />
        ) : null}
        {!commits && storyId ? <ReviewStorySourceLink projectId={projectId} storyId={storyId} /> : null}
      </p>
      {review ? <ReviewRuntimePanel projectId={projectId} reviewId={review.id} /> : null}
      {review?.worktreeSync ? (
        <ReviewTipSyncNotice
          projectId={projectId}
          reviewId={review.id}
          hold={review.worktreeSync}
        />
      ) : null}
      {header && header.failures.length > 0 ? (
        <div className="mt-2 flex flex-col gap-1">
          {header.failures.map((failure) => (
            <p
              key={failure.submissionId}
              className="flex items-start gap-1.5 text-sm text-destructive"
              data-testid="review-tasking-error"
              data-submission-id={failure.submissionId}
              role="status"
            >
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>{failure.message}</span>
            </p>
          ))}
        </div>
      ) : null}
      {header ? (
        <ReviewOpenThreads
          rounds={header.openRounds}
          threads={threads}
          threadsReady={loaded}
          onOpenThread={onOpenThread}
        />
      ) : null}
    </>
  );
}
