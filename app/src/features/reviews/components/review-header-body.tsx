import { useState } from "react";
import { CircleAlert, GitBranch } from "lucide-react";
import { Link } from "react-router-dom";
import type { ReviewCommits, ReviewPrSource, ReviewView } from "@server/schemas";
import type { CommentThread } from "@/features/issues/lib/comment-threads";
import { CommentGitHubIcon } from "@/features/issues/components/comments/comment-github-icon";
import { useReviewCommentThreads } from "../hooks/use-review-comments";
import { issuePath } from "@/features/issues/lib/links";
import { shortSha } from "@/lib/utils/short-sha";
import { submittableCommentThreads } from "../lib/review-submittable";
import {
  acknowledgedSubmissions,
  reviewSubmitHeader,
} from "../lib/review-submission-ui";
import { ReviewOpenThreads } from "./review-open-threads";
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
      className={sourceLinkClass}
      data-testid="review-story-link"
    >
      <GitBranch className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="text-foreground">{storyId}</span>
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

function CommitMeta({ commits }: { commits: ReviewCommits }) {
  const count = commits.commits.length;
  return (
    <>
      <span data-testid="review-merge-base">
        base <span className="text-foreground">{commits.mergeBaseRef}</span>
      </span>
      {count > 0 ? (
        <>
          <span>{count === 1 ? "1 commit" : `${count} commits`}</span>
          <span title={commits.tip}>
            tip <span className="text-foreground">{shortSha(commits.tip)}</span>
          </span>
        </>
      ) : null}
    </>
  );
}

/**
 * Title and actions stay above the branch line. The held-tip row sits on that
 * line. Failures and the open-thread disclosure render after it, so expanding
 * the list does not move them.
 */
export function ReviewHeaderBody({
  projectId,
  storyId,
  title,
  review,
  commits,
  merged,
  onOpenThread,
}: {
  projectId: string;
  storyId: string;
  title: string;
  review?: ReviewView;
  commits?: ReviewCommits;
  merged: boolean;
  onOpenThread?: (thread: CommentThread) => void;
}) {
  const { threads, loaded } = useReviewCommentThreads(review?.id ?? "");
  const readyThreads = loaded
    ? submittableCommentThreads(threads, review?.submissions ?? [])
    : undefined;
  const readyCount = readyThreads?.length;
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
            onAcknowledge={() =>
              setPendingThreadIds(readyThreads?.map((thread) => thread.root.id))
            }
            onAcknowledgeEnd={() => setPendingThreadIds(undefined)}
            onRetryStart={setRetryingIds}
            onRetryEnd={() => setRetryingIds(undefined)}
          />
        ) : null}
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-xs tabular-nums text-muted-foreground">
        {storyId ? <ReviewStorySourceLink projectId={projectId} storyId={storyId} /> : null}
        {review?.pr ? <ReviewPrSourceLink pr={review.pr} /> : null}
        {commits ? <CommitMeta commits={commits} /> : null}
      </p>
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
