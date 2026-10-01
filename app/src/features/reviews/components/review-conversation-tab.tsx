import { Check, RotateCcw } from "lucide-react";
import { ShellFaultDetail, ShellState } from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import { usePostComment } from "@/features/issues/api/mutations";
import { useCommentThreads, useCommentsQuery } from "@/features/issues/api/queries";
import { humanComment } from "@/features/issues/lib/comments";
import { conversationDraftKey } from "@/features/reviews/lib/review-draft-key";
import {
  Marker,
  commentDayKey,
  commentDayLabel,
} from "@/features/issues/components/comments/marker";
import { cn } from "@/lib/utils/cn";
import type { ReviewSubmission } from "@server/schemas";
import {
  STORY_COMPOSER_LABEL,
  type CommentThread as CommentThreadData,
} from "@/features/issues/lib/comment-threads";
import { ThreadLinkedTaskChip } from "@/features/issues/components/comments/thread-linked-task-chip";
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
      <p className="text-sm text-foreground">
        {reviewSubmittedLabel(submission.threadIds.length, submission.taskIds.length)}
      </p>
      <div className="flex flex-wrap gap-1.5">
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
  storyId,
  onOpenInDiff,
}: {
  items: ConversationTimelineItem<CommentThreadData>[];
  storyId: string;
  onOpenInDiff: (threadId: string, commitSha: string) => void;
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
              storyId={storyId}
              showAnchorContext
              collapse="resolved"
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

/** Chronological Story comments and threads, with a general-comment composer. */
export function ReviewConversationTab({
  storyId,
  submissions = [],
  onOpenInDiff,
}: {
  storyId: string;
  submissions?: ReviewSubmission[];
  onOpenInDiff: (threadId: string, commitSha: string) => void;
}) {
  const comments = useCommentsQuery(storyId);
  const { threads, problems } = useCommentThreads(storyId);
  const post = usePostComment(storyId);

  const send = (body: string, kind?: "question") =>
    post(humanComment(body, kind));

  const { filter, toggle, reset } = useConversationFilter();
  const timeline = conversationTimelineItems(threads, submissions);
  const visible = filterConversationTimeline(timeline, filter);
  const commentsReady = !comments.error && !comments.isLoading;

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col"
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
      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-3">
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
            detail="Add one below to leave a note on this Story."
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
            storyId={storyId}
            onOpenInDiff={onOpenInDiff}
          />
        ) : null}
      </div>
      <div
        className="flex min-w-0 shrink-0 flex-col gap-2 border-t border-border px-1 py-3"
        data-testid="review-conversation-composer"
      >
        <ReviewComposer
          draftKey={conversationDraftKey(storyId)}
          placeholder={STORY_COMPOSER_LABEL}
          submitLabel="Send"
          persistent
          onSubmit={(body) => send(body)}
          onQuestion={(body) => send(body, "question")}
        />
      </div>
    </div>
  );
}
