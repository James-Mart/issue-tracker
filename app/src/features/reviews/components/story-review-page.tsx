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
import { Button } from "@/components/ui/button";
import { TabButton } from "@/components/ui/tab-button";
import { ApiError } from "@/lib/api/errors";
import { useIssueDetailQuery } from "@/features/issues/api/queries";
import { useOpenReview } from "../api/mutations";
import { useReviewDiffQuery } from "../api/queries";
import { useStoryReviewList } from "../hooks/use-review-submission-sync";
import type { ReviewMarkOverrides } from "../lib/review-scope";
import { useReviewLiveRefresh } from "../hooks/use-review-live-refresh";
import { useReviewWorkbenchLocation } from "../hooks/use-review-workbench-location";
import { ALL_CHANGES_SCOPE } from "../lib/review-scope";
import { REVIEW_WORKBENCH_TABS } from "../lib/workbench-tabs";
import { ReviewCommitsPanel } from "./review-commits-tab";
import { ReviewConversationTab } from "./review-conversation-tab";
import { ReviewDiffTab } from "./review-diff-tab";
import { ReviewNoCommits } from "./review-no-commits";
import { StoryReviewHeader } from "./story-review-header";

/** Desktop bounds the page so the file tree and diff stack scroll on their own. */
const BOUNDED_REVIEW_SHELL_CLASS =
  "shell:h-[calc(100svh-3rem)] shell:min-h-0 shell:overflow-hidden";

function StartReviewState({
  projectId,
  storyId,
}: {
  projectId: string;
  storyId: string;
}) {
  const open = useOpenReview(projectId);
  return (
    <ShellState
      eyebrow="Code review"
      title="No review for this Story yet."
      detail="Start a review to work through the Story's changes file by file. Reviewed marks are saved with the review."
      action={
        <Button
          variant="current"
          disabled={open.isPending}
          onClick={() => open.mutate(storyId)}
        >
          Start review
        </Button>
      }
    />
  );
}

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
  onFocusFileMissing: () => void;
}) {
  const diffReady = scope === ALL_CHANGES_SCOPE || commits.data !== undefined;
  const diff = useReviewDiffQuery(projectId, review.id, scope, { enabled: diffReady });
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
      onFocusFileMissing={onFocusFileMissing}
    />
  );
}

function StoryReviewWorkbench({
  projectId,
  storyId,
  storyTitle,
  review,
  merged,
}: {
  projectId: string;
  storyId: string;
  storyTitle: string;
  review: ReviewView;
  merged: boolean;
}) {
  const commits = useReviewLiveRefresh(projectId, review.id);
  const knownShas = commits.data?.commits.map((commit) => commit.sha);
  const {
    active,
    setTab,
    scope,
    setScope,
    threadId,
    openThreadInDiff,
    openThread,
    retargetThreadScope,
  } = useReviewWorkbenchLocation(knownShas);
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
        className="flex shrink-0 gap-1 border-b border-border"
      >
        {REVIEW_WORKBENCH_TABS.map((tab) => (
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
            storyId={storyId}
            submissions={review.submissions}
            onOpenInDiff={openThreadInDiff}
            focusThreadId={threadId}
          />
        ) : active === "commits" ? (
          <ReviewCommitsPanel
            projectId={projectId}
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
            onFocusFileMissing={() => retargetThreadScope(ALL_CHANGES_SCOPE)}
          />
        )}
      </div>
    </>
  );
}

function StoryReviewBody({
  projectId,
  storyId,
}: {
  projectId: string;
  storyId: string;
}) {
  const story = useIssueDetailQuery(storyId);
  const reviews = useStoryReviewList(projectId, storyId);
  const error = story.error ?? reviews.error;
  const missing = story.error instanceof ApiError && story.error.status === 404;

  if (missing || (story.data && story.data.kind !== "story")) {
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
  if (!story.data || !reviews.data) {
    return <ShellLoadingState label="Loading review…" />;
  }
  const review = reviews.data.reviews[0];
  if (!review) {
    return (
      <>
        <StoryReviewHeader
          projectId={projectId}
          storyId={storyId}
          storyTitle={story.data.title}
          merged={story.data.kind === "story" && story.data.merged}
        />
        <StartReviewState projectId={projectId} storyId={storyId} />
      </>
    );
  }
  return (
    <StoryReviewWorkbench
      projectId={projectId}
      storyId={storyId}
      storyTitle={story.data.title}
      review={review}
      merged={story.data.kind === "story" && story.data.merged}
    />
  );
}

export function StoryReviewPage() {
  const { projectId = "", storyId = "" } = useParams();
  return (
    <PageShell className={BOUNDED_REVIEW_SHELL_CLASS} data-testid="story-review-page">
      <StoryReviewBody projectId={projectId} storyId={storyId} />
    </PageShell>
  );
}
