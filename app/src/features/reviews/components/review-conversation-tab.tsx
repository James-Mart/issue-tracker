import { useLayoutEffect, useRef } from "react";
import { Check, RotateCcw } from "lucide-react";
import { ShellFaultDetail, ShellState } from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import { usePostComment } from "@/features/issues/api/mutations";
import {
  useReviewCommentsQuery,
  useReviewCommentThreads,
} from "../hooks/use-review-comments";
import { humanComment } from "@/features/issues/lib/comments";
import { conversationDraftKey } from "@/features/reviews/lib/review-draft-key";
import {
  Marker,
  commentDayKey,
  commentDayLabel,
} from "@/features/issues/components/comments/marker";
import { scrollThreadNodeInPanel } from "@/features/issues/lib/issue-change-focus-thread";
import { cn } from "@/lib/utils/cn";
import type { ReviewSubmission } from "@server/schemas";
import {
  REVIEW_COMPOSER_LABEL,
  type CommentThread as CommentThreadData,
} from "@/features/issues/lib/comment-threads";
import { ThreadLinkedTaskChip } from "@/features/issues/components/comments/thread-linked-task-chip";
import { IssueChip } from "@/features/issues/components/issue-chip";
import {
  CONVERSATION_FILTER_CHIPS,
  conversationFilterCounts,
  conversationFilterIsDefault,
  filterConversationTimeline,
  useConversationFilter,
  type ConversationFilter,
  type ConversationFilterCounts,
  type ConversationFilterKey,
} from "../lib/review-conversation-filter";
import {
  conversationTimelineItems,
  reviewSubmittedLabel,
  type ConversationTimelineItem,
} from "../lib/review-submission-ui";
import { ReviewComposer } from "./review-composer";
import { ReviewThread } from "./review-thread";

function ReviewSubmittedEvent({
  submission,
}: {
  submission: Extract<ReviewSubmission, { status: "done" }>;
}) {
  return (
    <article
      data-testid="review-submitted-event"
      data-submission-id={submission.id}
      className="flex flex-col gap-1.5 border-b border-border py-3"
    >
      <p className="text-sm text-foreground">{reviewSubmittedLabel(submission)}</p>
      <div className="flex flex-wrap gap-1.5">
        {submission.ideaId ? (
          <IssueChip id={submission.ideaId} testId="review-submitted-idea" />
        ) : null}
        {submission.taskIds.map((taskId) => (
          <ThreadLinkedTaskChip key={taskId} taskId={taskId} />
        ))}
      </div>
    </article>
  );
}

function ConversationFilterBar({
  filter,
  counts,
  showReset,
  onToggle,
  onReset,
}: {
  filter: ConversationFilter;
  counts: ConversationFilterCounts;
  showReset: boolean;
  onToggle: (key: ConversationFilterKey) => void;
  onReset: () => void;
}) {
  return (
    <div
      className="flex shrink-0 flex-col gap-2 border-b border-border px-1 py-2 shell:flex-row shell:flex-wrap shell:items-center"
      data-testid="review-conversation-filter"
    >
      <span className="font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Show
      </span>
      <div
        className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5"
        role="group"
        aria-label="Show"
      >
        {CONVERSATION_FILTER_CHIPS.map((chip) => {
          const selected = filter[chip.key];
          return (
            <Button
              key={chip.key}
              type="button"
              size="sm"
              variant={selected ? "primary" : "outline"}
              aria-pressed={selected}
              data-testid={`conversation-filter-${chip.key}`}
              className={cn(
                "font-normal",
                !selected && "bg-transparent text-muted-foreground",
              )}
              onClick={() => onToggle(chip.key)}
            >
              {selected ? <Check aria-hidden /> : null}
              <span>{chip.label}</span>
              <span className="font-mono text-xs tabular-nums">{` · ${counts[chip.key]}`}</span>
            </Button>
          );
        })}
      </div>
      {showReset ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-end text-muted-foreground shell:self-center"
          data-testid="conversation-filter-reset"
          onClick={onReset}
        >
          <RotateCcw aria-hidden />
          Reset
        </Button>
      ) : null}
    </div>
  );
}

function ConversationTimeline({
  items,
  reviewId,
  onOpenInDiff,
  focusThreadId,
}: {
  items: ConversationTimelineItem<CommentThreadData>[];
  reviewId: string;
  onOpenInDiff: (threadId: string, commitSha: string) => void;
  focusThreadId: string | null;
}) {
  let lastDay = "";
  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => {
        const key = commentDayKey(item.at);
        const showMarker = key !== lastDay;
        lastDay = key;
        if (item.kind === "submitted") {
          return (
            <div key={`submission:${item.submission.id}`} className="flex min-w-0 flex-col">
              {showMarker ? <Marker>{commentDayLabel(item.at)}</Marker> : null}
              <ReviewSubmittedEvent submission={item.submission} />
            </div>
          );
        }
        const thread = item.thread;
        const anchor = thread.root.anchor;
        return (
          <div key={`thread:${thread.root.id}`} className="flex min-w-0 flex-col">
            {showMarker ? <Marker>{commentDayLabel(thread.root.at)}</Marker> : null}
            <ReviewThread
              thread={thread}
              reviewId={reviewId}
              showAnchorContext
              collapse="resolved"
              highlighted={thread.root.id === focusThreadId}
              onSeeInDiff={
                anchor
                  ? () => onOpenInDiff(thread.root.id, anchor.commitSha)
                  : undefined
              }
            />
          </div>
        );
      })}
    </div>
  );
}

/** Chronological review comments and threads, with a general-comment composer. */
export function ReviewConversationTab({
  reviewId,
  submissions = [],
  onOpenInDiff,
  focusThreadId = null,
  focusSubmissionId = null,
  onSubmissionFocused,
}: {
  reviewId: string;
  submissions?: ReviewSubmission[];
  onOpenInDiff: (threadId: string, commitSha: string) => void;
  /** Thread from `?thread=`: scrolled to, highlighted, and kept past the filter. */
  focusThreadId?: string | null;
  /** Submitted round to scroll into view after an Agents card names it. */
  focusSubmissionId?: string | null;
  onSubmissionFocused?: () => void;
}) {
  const comments = useReviewCommentsQuery(reviewId);
  const { threads, problems } = useReviewCommentThreads(reviewId);
  const post = usePostComment(reviewId);

  const send = (body: string, kind?: "question") =>
    post(humanComment(body, kind));

  const { filter, toggle, reset } = useConversationFilter();
  const timeline = conversationTimelineItems(threads, submissions);
  const visible = filterConversationTimeline(timeline, filter, focusThreadId);
  const commentsReady = !comments.error && !comments.isLoading;
  const scrollerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!focusThreadId || !commentsReady) return;
    const panel = scrollerRef.current;
    if (!panel) return;
    return scrollThreadNodeInPanel(panel, focusThreadId, { block: "center" });
  }, [commentsReady, focusThreadId, threads]);

  useLayoutEffect(() => {
    if (!focusSubmissionId || !commentsReady) return;
    const node = scrollerRef.current?.querySelector(
      `[data-submission-id="${CSS.escape(focusSubmissionId)}"]`,
    );
    if (!node) return;
    node.scrollIntoView({ block: "nearest" });
    onSubmissionFocused?.();
  }, [commentsReady, focusSubmissionId, onSubmissionFocused, submissions, threads]);

  return (
    <div
      className="review-conversation flex min-h-0 min-w-0 flex-1 flex-col"
      data-testid="review-conversation-tab"
    >
      {commentsReady ? (
        <ConversationFilterBar
          filter={filter}
          counts={conversationFilterCounts(timeline)}
          showReset={!conversationFilterIsDefault(filter)}
          onToggle={toggle}
          onReset={reset}
        />
      ) : null}
      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto px-1 py-3">
        {comments.error ? (
          <ShellState
            tone="blocked"
            title="Could not load comments."
            detail={
              <ShellFaultDetail
                message={comments.error.message}
                hint="Check the server, then reload."
              />
            }
          />
        ) : comments.isLoading ? (
          <p className="px-1 py-4 text-sm text-muted-foreground">Loading comments…</p>
        ) : problems.length > 0 ? (
          <div className="mb-3 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-muted-foreground">
            <p className="text-foreground">
              Some comment lines are unreadable and are not shown. Fix them on
              disk, then reload.
            </p>
            {problems.map((problem) => (
              <div key={problem.message} className="mt-1.5 font-mono">
                {problem.message}
              </div>
            ))}
          </div>
        ) : null}
        {commentsReady && timeline.length === 0 ? (
          <ShellState
            className="border-0 bg-transparent px-4 py-8 shadow-none"
            title="No comments yet."
            detail="Add one below to leave a note on this review."
          />
        ) : null}
        {commentsReady && timeline.length > 0 && visible.length === 0 ? (
          <ShellState
            className="border-0 bg-transparent px-4 py-8 shadow-none"
            eyebrow="Filtered"
            title="Nothing matches these filters."
            detail="Turn a category back on, or reset to the default view."
          />
        ) : null}
        {commentsReady && visible.length > 0 ? (
          <ConversationTimeline
            items={visible}
            reviewId={reviewId}
            onOpenInDiff={onOpenInDiff}
            focusThreadId={focusThreadId}
          />
        ) : null}
      </div>
      <div
        className="flex min-w-0 shrink-0 flex-col gap-2 border-t border-border px-1 py-3"
        data-testid="review-conversation-composer"
      >
        <ReviewComposer
          draftKey={conversationDraftKey(reviewId)}
          placeholder={REVIEW_COMPOSER_LABEL}
          submitLabel="Send"
          persistent
          onSubmit={(body) => send(body)}
          onQuestion={(body) => send(body, "question")}
        />
      </div>
    </div>
  );
}
