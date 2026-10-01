import { ShellFaultDetail, ShellState } from "@/app/shell-state";
import { usePostComment } from "@/features/issues/api/mutations";
import { useCommentThreads, useCommentsQuery } from "@/features/issues/api/queries";
import type { ThreadMessage } from "@/features/issues/lib/comment-outbox";
import { humanComment } from "@/features/issues/lib/comments";
import { conversationDraftKey } from "@/features/reviews/lib/review-draft-key";
import { DeliverableMessage } from "@/features/issues/components/comments/comment-delivery";
import {
  Marker,
  commentDayKey,
  commentDayLabel,
} from "@/features/issues/components/comments/marker";
import { isHumanRole } from "@/features/issues/components/comments/message";
import { roleFamilyCaption } from "@/features/pipeline/role-family";
import type { ReviewSubmission } from "@server/schemas";
import {
  isPlainNote,
  STORY_COMPOSER_LABEL,
  type CommentThread as CommentThreadData,
} from "@/features/issues/lib/comment-threads";
import { ThreadLinkedTaskChip } from "@/features/issues/components/comments/thread-linked-task-chip";
import {
  conversationTimelineItems,
  reviewSubmittedLabel,
  type ConversationTimelineItem,
} from "../lib/review-submission-ui";
import { ReviewComposer } from "./review-composer";
import { ReviewThread } from "./review-thread";

function StandaloneComment({
  message,
  storyId,
}: {
  message: ThreadMessage;
  storyId: string;
}) {
  const author = isHumanRole(message.role)
    ? (message.name ?? message.role)
    : roleFamilyCaption(message.role).caption;
  return (
    <DeliverableMessage message={message} author={author} attachmentsIssueId={storyId} />
  );
}

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
            {isPlainNote(thread) ? (
              <StandaloneComment message={thread.root} storyId={storyId} />
            ) : (
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
            )}
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

  const timeline = conversationTimelineItems(threads, submissions);
  const commentsReady = !comments.error && !comments.isLoading;

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      data-testid="review-conversation-tab"
    >
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
        {commentsReady && timeline.length > 0 ? (
          <ConversationTimeline
            items={timeline}
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
