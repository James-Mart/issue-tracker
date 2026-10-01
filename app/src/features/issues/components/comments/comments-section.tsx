import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { Send } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import type { IssueDetail, ThreadEventRequest } from "@server/schemas";
import { ShellFaultDetail, ShellState } from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ReviewComposer } from "@/features/reviews/components/review-composer";
import {
  conversationDraftKey,
  replyDraftKey,
} from "@/features/reviews/lib/review-draft-key";
import {
  useCommentThreads,
  useCommentsQuery,
  useIssuesQuery,
} from "../../api/queries";
import { usePostComment, usePostThreadEvent } from "../../api/mutations";
import { supportsAttachments } from "../../lib/attachments";
import {
  isPlainNote,
  isQuestionThread,
  STORY_COMPOSER_LABEL,
  threadStateActions,
  type CommentThread as CommentThreadData,
} from "../../lib/comment-threads";
import { humanComment, supportsComments } from "../../lib/comments";
import { isInFlight } from "../../lib/derived";
import { writeDiffThreadSearchParam } from "../../lib/issue-detail-tabs";
import { SettingsCard } from "../detail-section";
import { DeliverableMessage } from "./comment-delivery";
import { CommentThread } from "./comment-thread";
import { Marker, commentDayKey, commentDayLabel } from "./marker";
import { Shimmer } from "./shimmer";

const COMPOSER_ROLE = "human";

function ThreadReplyComposer({
  threadId,
  draft,
  onDraftChange,
  onSend,
}: {
  threadId: string;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  };

  return (
    <div
      data-testid="comment-log-reply-composer"
      data-thread-id={threadId}
      className="flex min-w-0 items-end gap-2"
    >
      <Textarea
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Reply"
        title="Enter to send, Shift+Enter for a newline"
        aria-label="Reply"
        className="min-h-[40px] min-w-0 flex-1 resize-none touch:min-h-[44px]"
      />
      <Button
        size="icon"
        variant="primary"
        className="h-11 w-11 shrink-0"
        onClick={onSend}
        disabled={!draft.trim()}
        title="Send"
        aria-label="Send"
      >
        <Send className="h-4 w-4" />
      </Button>
    </div>
  );
}

function CommentList({
  threads,
  issueId,
  attachmentsIssueId,
  replySlotFor,
  onReply,
  onSeeInDiff,
  storyComposer,
  onThreadEvent,
  eventPending,
}: {
  threads: CommentThreadData[];
  issueId: string;
  attachmentsIssueId?: string;
  replySlotFor: (threadId: string) => ReactNode;
  onReply: (threadId: string) => void;
  onSeeInDiff: (threadId: string) => void;
  storyComposer: boolean;
  onThreadEvent: (
    threadId: string,
    event: ThreadEventRequest["event"],
  ) => void;
  eventPending: boolean;
}) {
  let lastDay = "";
  return (
    <div className="flex flex-col gap-3">
      {threads.map((thread) => {
        const key = commentDayKey(thread.root.at);
        const showMarker = key !== lastDay;
        lastDay = key;
        return (
          <div
            key={thread.root.id}
            data-log-root={thread.root.id}
            className="flex flex-col"
          >
            {showMarker ? <Marker>{commentDayLabel(thread.root.at)}</Marker> : null}
            {isPlainNote(thread) ? (
              <DeliverableMessage
                message={thread.root}
                author={thread.root.name ?? thread.root.role}
                attachmentsIssueId={attachmentsIssueId}
              />
            ) : (
              <CommentThread
                thread={thread}
                issueId={issueId}
                showAnchorContext
                resolvePending={eventPending}
                onSeeInDiff={
                  thread.root.anchor
                    ? () => onSeeInDiff(thread.root.id)
                    : undefined
                }
                onReply={() => onReply(thread.root.id)}
                replySlot={replySlotFor(thread.root.id)}
                {...(storyComposer &&
                (isQuestionThread(thread) || thread.converted)
                  ? threadStateActions(thread, (event) =>
                      onThreadEvent(thread.root.id, event),
                    )
                  : {})}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Inline per-issue comments thread + composer for the detail reading column. */
export function IssueCommentsSection({ issue }: { issue: IssueDetail }) {
  if (!supportsComments(issue.kind)) return null;

  const attachmentsIssueId = supportsAttachments(issue.kind)
    ? issue.id
    : undefined;

  return (
    <div data-region="comments" id="comments" className="scroll-mt-8">
      <CommentsPanel
        id={issue.id}
        attachmentsIssueId={attachmentsIssueId}
        storyComposer={issue.kind === "story"}
      />
    </div>
  );
}

function CommentsPanel({
  id,
  attachmentsIssueId,
  storyComposer,
}: {
  id: string;
  attachmentsIssueId?: string;
  storyComposer: boolean;
}) {
  const { isLoading, error } = useCommentsQuery(id);
  const { threads, problems } = useCommentThreads(id);
  const { data: list } = useIssuesQuery();
  const post = usePostComment(id);
  const events = usePostThreadEvent(id);
  const [, setSearchParams] = useSearchParams();
  const [draft, setDraft] = useState("");
  const [openReplyId, setOpenReplyId] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});

  const agentLive = useMemo(() => {
    const issue = list?.issues.find((item) => item.id === id);
    if (!issue) return false;
    return isInFlight(issue, list?.derived[id]);
  }, [id, list?.derived, list?.issues]);

  const sendStory = (body: string, kind?: "question") =>
    post(humanComment(body, kind));

  const sendIssue = () => {
    const body = draft.trim();
    if (!body) return;
    post(humanComment(body));
    setDraft("");
  };

  const closeReply = (threadId: string) =>
    setOpenReplyId((open) => (open === threadId ? null : open));

  const sendStoryReply = (threadId: string, body: string) => {
    post({ role: COMPOSER_ROLE, body, replyTo: threadId });
    closeReply(threadId);
  };

  const sendIssueReply = (threadId: string) => {
    const body = (replyDrafts[threadId] ?? "").trim();
    if (!body) return;
    post({ role: COMPOSER_ROLE, body, replyTo: threadId });
    setReplyDrafts((prev) => {
      const next = { ...prev };
      delete next[threadId];
      return next;
    });
    closeReply(threadId);
  };

  const onIssueKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendIssue();
    }
  };

  const replySlotFor = (threadId: string) => {
    if (openReplyId !== threadId) return undefined;
    if (!storyComposer) {
      return (
        <ThreadReplyComposer
          threadId={threadId}
          draft={replyDrafts[threadId] ?? ""}
          onDraftChange={(value) =>
            setReplyDrafts((prev) => ({ ...prev, [threadId]: value }))
          }
          onSend={() => sendIssueReply(threadId)}
        />
      );
    }
    return (
      <div
        data-testid="comment-log-reply-composer"
        data-thread-id={threadId}
      >
        <ReviewComposer
          draftKey={replyDraftKey(id, threadId)}
          placeholder="Reply"
          submitLabel="Send"
          onSubmit={(body) => sendStoryReply(threadId, body)}
          onCancel={() => setOpenReplyId(null)}
        />
      </div>
    );
  };

  return (
    <SettingsCard title="Comments">
      <div className="flex flex-col gap-3">
        {error ? (
          <ShellState
            tone="blocked"
            title="Could not load comments."
            detail={
              <ShellFaultDetail
                message={error.message}
                hint="Check the server, then reload."
              />
            }
          />
        ) : null}

        {problems.length > 0 ? (
          <div className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-muted-foreground">
            <p className="text-foreground">
              Some comment lines are unreadable and are not shown. Fix them on
              disk, then reload.
            </p>
            {problems.map((p) => (
              <div key={p.message} className="mt-1.5 font-mono">
                {p.message}
              </div>
            ))}
          </div>
        ) : null}

        {error ? null : isLoading ? (
          <p className="px-1 py-4 text-sm text-muted-foreground">
            Loading comments…
          </p>
        ) : threads.length === 0 ? (
          <ShellState
            title="No comments yet."
            detail="Add one below to leave a note on this issue."
          />
        ) : (
          <CommentList
            threads={threads}
            issueId={id}
            attachmentsIssueId={attachmentsIssueId}
            replySlotFor={replySlotFor}
            onReply={setOpenReplyId}
            storyComposer={storyComposer}
            eventPending={events.isPending}
            onThreadEvent={(threadId, event) =>
              events.mutate({ threadId, event })
            }
            onSeeInDiff={(threadId) =>
              setSearchParams((prev) => writeDiffThreadSearchParam(prev, threadId), {
                replace: true,
              })
            }
          />
        )}

        {agentLive ? <Shimmer /> : null}

        {storyComposer ? (
          <div className="flex min-w-0 shrink-0 flex-col gap-2 border-t border-border pt-3">
            <ReviewComposer
              draftKey={conversationDraftKey(id)}
              placeholder={STORY_COMPOSER_LABEL}
              submitLabel="Send"
              persistent
              onSubmit={(body) => sendStory(body)}
              onQuestion={(body) => sendStory(body, "question")}
            />
          </div>
        ) : (
          <div className="flex min-w-0 shrink-0 items-end gap-2 border-t border-border pt-3">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onIssueKeyDown}
              placeholder="Add a comment"
              title="Enter to send, Shift+Enter for a newline"
              aria-label="Add a comment"
              className="min-h-[40px] min-w-0 flex-1 resize-none touch:min-h-[44px]"
            />
            <Button
              size="icon"
              variant="primary"
              className="h-11 w-11 shrink-0"
              onClick={sendIssue}
              disabled={!draft.trim()}
              title="Send"
              aria-label="Send"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </SettingsCard>
  );
}
