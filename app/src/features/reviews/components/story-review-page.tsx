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
import { useReviewDiffQuery, useReviewsQuery } from "../api/queries";
import { useReviewLiveRefresh } from "../hooks/use-review-live-refresh";
import { useReviewWorkbenchTab } from "../hooks/use-review-workbench-tab";
import { REVIEW_WORKBENCH_TABS } from "../lib/workbench-tabs";
import { ReviewDiffTab } from "./review-diff-tab";
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
}: {
  projectId: string;
  storyId: string;
  review: ReviewView;
  commits: UseQueryResult<ReviewCommits>;
}) {
  const diff = useReviewDiffQuery(projectId, review.id, "all");
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
    return (
      <div data-testid="review-empty-diff">
        <ShellState
          className="border-0 bg-transparent px-4 py-8 shadow-none"
          eyebrow="Diff"
          title="No commits on this Story yet."
          detail="When a Task records a commit, its changes appear here for review."
        />
      </div>
    );
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
    />
  );
}

function StoryReviewWorkbench({
  projectId,
  storyId,
  storyTitle,
  review,
}: {
  projectId: string;
  storyId: string;
  storyTitle: string;
  review: ReviewView;
}) {
  const commits = useReviewLiveRefresh(projectId, review.id);
  const { active, setTab } = useReviewWorkbenchTab();

  return (
    <>
      <StoryReviewHeader
        projectId={projectId}
        storyId={storyId}
        storyTitle={storyTitle}
        review={review}
        commits={commits.data}
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
        {active === "diff" ? (
          <DiffTabPanel
            projectId={projectId}
            storyId={storyId}
            review={review}
            commits={commits}
          />
        ) : null}
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
  const reviews = useReviewsQuery(projectId, storyId);
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
