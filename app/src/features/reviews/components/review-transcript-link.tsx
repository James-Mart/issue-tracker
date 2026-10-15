import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import type { ReviewAgentRun } from "@server/schemas";
import { cn } from "@/lib/utils/cn";
import { useReviewRunSearch } from "../hooks/use-review-run-search";
import { useWideReviewWorkbench } from "../hooks/use-wide-review-workbench";
import {
  latestAssessorTranscriptRun,
  researcherTranscriptRun,
  taskerTranscriptRun,
} from "../lib/review-agent-runs";
import type { ReviewRunReturn } from "../lib/review-run-search";

/** Shared look for a reverse link into a review run's transcript. */
export const REVIEW_TRANSCRIPT_LINK_CLASS =
  "text-left text-[hsl(var(--current))] underline underline-offset-2";

const NO_REVIEW_AGENT_RUNS: readonly ReviewAgentRun[] = [];

type ReviewTranscriptLinks = {
  researcherConversationId: (threadId: string) => string | undefined;
  openResearcher: (threadId: string, conversationId: string) => void;
  taskerConversationId: (submissionId: string) => string | undefined;
  openTasker: (submissionId: string, conversationId: string) => void;
  assessorConversationId: (submissionId: string) => string | undefined;
  openAssessor: (submissionId: string, conversationId: string) => void;
};

const ReviewTranscriptLinkContext = createContext<ReviewTranscriptLinks | null>(null);

/** The submitted line or Standards round title, when that run exists. */
export function ReviewTranscriptLinkButton({
  testId,
  className,
  onClick,
  children,
}: {
  testId: string;
  className?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn("min-h-11 max-w-full", REVIEW_TRANSCRIPT_LINK_CLASS, className)}
      data-testid={testId}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Opens a review run from the thread, a submitted round, or a Standards round. */
export function ReviewTranscriptLinkProvider({
  runs = NO_REVIEW_AGENT_RUNS,
  children,
}: {
  runs?: readonly ReviewAgentRun[];
  children: ReactNode;
}) {
  const wide = useWideReviewWorkbench();
  const { openRun } = useReviewRunSearch();

  const open = useCallback(
    (conversationId: string, returnTo: ReviewRunReturn) => {
      if (wide === true) {
        openRun(conversationId, { tab: "agents" });
        return;
      }
      openRun(conversationId, { returnTo });
    },
    [openRun, wide],
  );

  const value = useMemo<ReviewTranscriptLinks>(
    () => ({
      researcherConversationId: (threadId) =>
        researcherTranscriptRun(runs, threadId)?.conversationId,
      openResearcher: (threadId, conversationId) => {
        open(conversationId, { surface: "thread", threadId });
      },
      taskerConversationId: (submissionId) =>
        taskerTranscriptRun(runs, submissionId)?.conversationId,
      openTasker: (submissionId, conversationId) => {
        open(conversationId, { surface: "conversation", submissionId });
      },
      assessorConversationId: (submissionId) =>
        latestAssessorTranscriptRun(runs, submissionId)?.conversationId,
      openAssessor: (submissionId, conversationId) => {
        open(conversationId, { surface: "standards", submissionId });
      },
    }),
    [open, runs],
  );

  return (
    <ReviewTranscriptLinkContext.Provider value={value}>
      {children}
    </ReviewTranscriptLinkContext.Provider>
  );
}

/** Null outside the review workbench, where these lines are not transcript links. */
export function useReviewTranscriptLinks(): ReviewTranscriptLinks | null {
  return useContext(ReviewTranscriptLinkContext);
}
