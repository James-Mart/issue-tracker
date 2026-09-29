import { useState, type KeyboardEvent } from "react";
import { Send } from "lucide-react";
import { ShellFaultDetail, ShellState } from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { usePostComment } from "@/features/issues/api/mutations";
import { useCommentThreads, useCommentsQuery } from "@/features/issues/api/queries";
import { Markdown } from "@/features/issues/components/markdown";
import {
  Marker,
  commentDayKey,
  commentDayLabel,
} from "@/features/issues/components/comments/marker";
import { isHumanRole, Message } from "@/features/issues/components/comments/message";
import { roleFamilyCaption } from "@/features/pipeline/role-family";
import { Shimmer } from "@/features/issues/components/comments/shimmer";
import type { CommentMessage, ReviewSubmission } from "@server/schemas";
import type { CommentThread as CommentThreadData } from "@/features/issues/lib/comment-threads";
import { ThreadLinkedTaskChip } from "@/features/issues/components/comments/thread-linked-task-chip";
import {
  conversationTimelineItems,
  reviewSubmittedLabel,
  type ConversationTimelineItem,
} from "../lib/review-submission-ui";
import { ReviewThread } from "./review-thread";

const COMPOSER_ROLE = "human";

function isStandaloneComment(thread: CommentThreadData): boolean {
  return thread.root.anchor === undefined && thread.replies.length === 0;
}

function StandaloneComment({
  message,
  storyId,
}: {
  message: CommentMessage;
  storyId: string;
}) {
  const author = isHumanRole(message.role)
    ? (message.name ?? message.role)
    : roleFamilyCaption(message.role).caption;
  return (
    <Message author={author} role={message.role} at={message.at}>
      <Markdown issueId={storyId}>{message.body}</Markdown>
    </Message>
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
            {isStandaloneComment(thread) ? (
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
  const [draft, setDraft] = useState("");

  const send = () => {
    const body = draft.trim();
    if (!body || post.isPending) return;
    post.mutate(
      { role: COMPOSER_ROLE, body },
      { onSuccess: () => setDraft("") },
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

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
      {post.isPending ? <Shimmer label="Sending…" /> : null}
      <div className="flex min-w-0 shrink-0 items-end gap-2 border-t border-border px-1 py-3">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Add a comment"
          title="Enter to send, Shift+Enter for a newline"
          aria-label="Add a comment"
          data-testid="review-conversation-composer"
          className="min-h-[40px] min-w-0 flex-1 resize-none touch:min-h-[44px]"
        />
        <Button
          size="icon"
          variant="primary"
          className="h-11 w-11 shrink-0"
          onClick={send}
          disabled={post.isPending || !draft.trim()}
          title="Send"
          aria-label="Send"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
