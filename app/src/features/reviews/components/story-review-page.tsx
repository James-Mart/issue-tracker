import { useState, type Dispatch, type SetStateAction } from "react";
import { useParams } from "react-router-dom";
import type { UseQueryResult } from "@tanstack/react-query";
import type { ReviewCommits, ReviewView } from "@server/schemas";
import {
  ShellFaultDetail,
  ShellInlineFault,
  ShellLoadingState,
  ShellState,
} from "@/app/shell-state";
import { PageShell } from "@/components/page-shell";
import { tabTitleEntityName, useTabTitle } from "@/lib/tab-title/use-tab-title";
import { TabButton } from "@/components/ui/tab-button";
import { ApiError } from "@/lib/api/errors";
import { useIssueDetailQuery } from "@/features/issues/api/queries";
import { useReviewDiffQuery } from "../api/queries";
import type { ReviewMarkOverrides } from "../lib/review-scope";
import { useReviewWorkbenchReads } from "../hooks/use-review-workbench-reads";
import {
  useReviewWorkbenchLocation,
  type DiffThreadReveal,
} from "../hooks/use-review-workbench-location";
import { isPullRequestOnlyReview, pullRequestHeadSha } from "../lib/pull-request-head";
import { ALL_CHANGES_SCOPE } from "../lib/review-scope";
import { reviewWorkbenchTabs } from "../lib/workbench-tabs";
import { ReviewCommitsPanel } from "./review-commits-tab";
import { ReviewConversationTab } from "./review-conversation-tab";
import { ReviewDiffTab } from "./review-diff-tab";
import { ReviewNoCommits } from "./review-no-commits";
import { ReviewStandardsTab } from "./review-standards-tab";
import { StoryReviewHeader } from "./story-review-header";

/** Desktop bounds the page so the file tree and diff stack scroll on their own. */
const BOUNDED_REVIEW_SHELL_CLASS =
  "shell:h-[calc(100svh-3rem)] shell:min-h-0 shell:overflow-hidden";

/** Gates the Diff tab on its queries so `ReviewDiffTab` only sees loaded data. */
function DiffTabPanel({
  projectId,
  storyId,
  review,
  commits,
  scope,
  onScopeChange,
  overrides,
  setOverrides,
  focusThreadId,
  threadReveal,
  onThreadRevealed,
  onFocusFileMissing,
}: {
  projectId: string;
  storyId: string;
  review: ReviewView;
  commits: UseQueryResult<ReviewCommits>;
  scope: string;
  onScopeChange: (scope: string) => void;
  overrides: ReviewMarkOverrides;
  setOverrides: Dispatch<SetStateAction<ReviewMarkOverrides>>;
  focusThreadId: string | null;
  threadReveal: DiffThreadReveal | null;
  onThreadRevealed: (reveal: DiffThreadReveal) => void;
  onFocusFileMissing: () => void;
}) {
  const diffReady = scope === ALL_CHANGES_SCOPE || commits.data !== undefined;
  const diff = useReviewDiffQuery(projectId, storyId, scope, {
    enabled: diffReady,
    reviewId: storyId ? undefined : review.id,
    headSha: pullRequestHeadSha(storyId, review),
  });
  const error = commits.error ?? diff.error;
  if (error) {
    return (
      <ShellInlineFault
        message={error.message}
        hint="Check the project workspace, then reload."
      />
    );
  }
  if (commits.data?.commits.length === 0) {
    return <ReviewNoCommits eyebrow="Diff" />;
  }
  if (!commits.data || !diff.data) {
    return <ShellLoadingState label="Loading diff…" />;
  }
  return (
    <ReviewDiffTab
      projectId={projectId}
      storyId={storyId}
      review={review}
      diff={diff.data}
      commits={commits.data}
      scope={scope}
      onScopeChange={onScopeChange}
      overrides={overrides}
      setOverrides={setOverrides}
      focusThreadId={focusThreadId}
      threadReveal={threadReveal}
      onThreadRevealed={onThreadRevealed}
      onFocusFileMissing={onFocusFileMissing}
    />
  );
}

function StoryReviewWorkbench({
  projectId,
  storyId,
  storyTitle,
  review,
  commits,
  merged,
}: {
  projectId: string;
  storyId: string;
  storyTitle: string;
  review: ReviewView;
  commits: UseQueryResult<ReviewCommits, Error>;
  merged: boolean;
}) {
  const knownShas = commits.data?.commits.map((commit) => commit.sha);
  const tabs = reviewWorkbenchTabs(review.submissions);
  const {
    active,
    setTab,
    scope,
    setScope,
    threadId,
    threadReveal,
    markThreadRevealed,
    openThreadInDiff,
    conversationThreadSearch,
    openThread,
    retargetThreadScope,
  } = useReviewWorkbenchLocation(knownShas, tabs);
  const [markOverrides, setMarkOverrides] = useState<ReviewMarkOverrides>({});

  return (
    <>
      <StoryReviewHeader
        projectId={projectId}
        storyId={storyId}
        storyTitle={storyTitle}
        review={review}
        commits={commits.data}
        merged={merged}
        onOpenThread={openThread}
      />
      <div
        role="tablist"
        aria-label="Review"
        className="flex shrink-0 flex-wrap gap-1 border-b border-border shell:flex-nowrap"
      >
        {tabs.map((tab) => (
          <TabButton
            key={tab.key}
            selected={active === tab.key}
            onClick={() => setTab(tab.key)}
          >
            {tab.label}
          </TabButton>
        ))}
      </div>
      <div role="tabpanel" className="flex min-h-0 min-w-0 flex-1 flex-col">
        {active === "conversation" ? (
          <ReviewConversationTab
            reviewId={review.id}
            submissions={review.submissions}
            onOpenInDiff={openThreadInDiff}
            focusThreadId={threadId}
          />
        ) : active === "standards" ? (
          <ReviewStandardsTab
            projectId={projectId}
            reviewId={review.id}
            submissions={review.submissions}
            threadSearch={conversationThreadSearch}
          />
        ) : active === "commits" ? (
          <ReviewCommitsPanel
            projectId={projectId}
            storyId={storyId}
            review={review}
            commits={commits}
            scope={scope}
            overrides={markOverrides}
            onScopeChange={setScope}
          />
        ) : (
          <DiffTabPanel
            projectId={projectId}
            storyId={storyId}
            review={review}
            commits={commits}
            scope={scope}
            onScopeChange={setScope}
            overrides={markOverrides}
            setOverrides={setMarkOverrides}
            focusThreadId={threadId}
            threadReveal={threadReveal}
            onThreadRevealed={markThreadRevealed}
            onFocusFileMissing={() => retargetThreadScope(ALL_CHANGES_SCOPE)}
          />
        )}
      </div>
    </>
  );
}

function StoryReviewBody({
  projectId,
  reviewId,
}: {
  projectId: string;
  reviewId: string;
}) {
  const { review, commits, readsReady } = useReviewWorkbenchReads(projectId, reviewId);
  const storyId = review.data?.story ?? "";
  const prOnly = review.data !== undefined && isPullRequestOnlyReview(review.data);
  const story = useIssueDetailQuery(storyId);
  const storyTitle = prOnly
    ? review.data?.title
    : story.data?.kind === "story"
      ? story.data.title
      : review.data?.title;
  useTabTitle(tabTitleEntityName(storyTitle, reviewId), "Review");
  const error = review.error ?? (storyId ? story.error : null);
  const reviewMissing = review.error instanceof ApiError && review.error.status === 404;
  const storyMissing =
    !prOnly &&
    storyId.length > 0 &&
    story.error instanceof ApiError &&
    story.error.status === 404;

  if (reviewMissing) {
    return (
      <ShellState
        tone="blocked"
        eyebrow="Missing"
        title="No review with that id."
        detail={
          <ShellFaultDetail message={reviewId} hint="Open it from code review." />
        }
      />
    );
  }
  if (storyMissing || (story.data && story.data.kind !== "story")) {
    return (
      <ShellState
        tone="blocked"
        eyebrow="Missing"
        title="No Story with that id."
        detail={
          <ShellFaultDetail
            message={storyId}
            hint="Open the review from the Story's detail page."
          />
        }
      />
    );
  }
  if (error) {
    return (
      <ShellInlineFault message={error.message} hint="Check the server, then reload." />
    );
  }
  if (review.data && !readsReady) {
    return <ShellLoadingState label="Loading review…" />;
  }
  if (review.data && !review.data.story && !review.data.pr) {
    return (
      <ShellInlineFault
        message="This review has no linked source."
        hint="This review needs a Story or a pull request."
      />
    );
  }
  const ready =
    prOnly && review.data
      ? {
          storyId: "",
          storyTitle: review.data.title,
          review: review.data,
          merged: false,
        }
      : review.data && story.data?.kind === "story"
        ? {
            storyId: story.data.id,
            storyTitle: story.data.title,
            review: review.data,
            merged: story.data.merged,
          }
        : null;
  if (!ready) return <ShellLoadingState label="Loading review…" />;
  return (
    <StoryReviewWorkbench
      projectId={projectId}
      storyId={ready.storyId}
      storyTitle={ready.storyTitle}
      review={ready.review}
      commits={commits}
      merged={ready.merged}
    />
  );
}

export function StoryReviewPage() {
  const { projectId = "", id = "" } = useParams();
  return (
    <PageShell className={BOUNDED_REVIEW_SHELL_CLASS} data-testid="story-review-page">
      <StoryReviewBody projectId={projectId} reviewId={id} />
    </PageShell>
  );
}
