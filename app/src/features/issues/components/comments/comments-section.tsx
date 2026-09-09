import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { Send } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import type { CommentMessage, IssueDetail } from "@server/schemas";
import { ShellFaultDetail, ShellState } from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useCommentsQuery, useIssuesQuery } from "../../api/queries";
import { usePostComment } from "../../api/mutations";
import { supportsAttachments } from "../../lib/attachments";
import {
  groupCommentThreads,
  type CommentThread as CommentThreadData,
} from "../../lib/comment-threads";
import { supportsComments } from "../../lib/comments";
import { isInFlight } from "../../lib/derived";
import { writeDiffThreadSearchParam } from "../../lib/issue-detail-tabs";
import { SettingsCard } from "../detail-section";
import { Markdown } from "../markdown";
import { CommentThread } from "./comment-thread";
import { Marker } from "./marker";
import { Message } from "./message";
import { Shimmer } from "./shimmer";

const COMPOSER_ROLE = "human";

function dayKey(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? at : date.toDateString();
}

function dayLabel(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function isStandaloneUnanchored(thread: CommentThreadData): boolean {
  return thread.root.anchor === undefined && thread.replies.length === 0;
}

function StandaloneComment({
  message,
  attachmentsIssueId,
}: {
  message: CommentMessage;
  attachmentsIssueId?: string;
}) {
  const author = message.name ?? message.role;
  return (
    <Message author={author} role={message.role} at={message.at}>
      <Markdown issueId={attachmentsIssueId}>{message.body}</Markdown>
    </Message>
  );
}

function ThreadReplyComposer({
  threadId,
  draft,
  onDraftChange,
  onSend,
  pending,
}: {
  threadId: string;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  pending: boolean;
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
        disabled={pending || !draft.trim()}
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
}: {
  threads: CommentThreadData[];
  issueId: string;
  attachmentsIssueId?: string;
  replySlotFor: (threadId: string) => ReactNode;
  onReply: (threadId: string) => void;
  onSeeInDiff: (threadId: string) => void;
}) {
  let lastDay = "";
  return (
    <div className="flex flex-col gap-3">
      {threads.map((thread) => {
        const key = dayKey(thread.root.at);
        const showMarker = key !== lastDay;
        lastDay = key;
        return (
          <div
            key={thread.root.id}
            data-log-root={thread.root.id}
            className="flex flex-col"
          >
            {showMarker ? <Marker>{dayLabel(thread.root.at)}</Marker> : null}
            {isStandaloneUnanchored(thread) ? (
              <StandaloneComment
                message={thread.root}
                attachmentsIssueId={attachmentsIssueId}
              />
            ) : (
              <CommentThread
                thread={thread}
                issueId={issueId}
                showAnchorContext
                onSeeInDiff={
                  thread.root.anchor
                    ? () => onSeeInDiff(thread.root.id)
                    : undefined
                }
                onReply={() => onReply(thread.root.id)}
                replySlot={replySlotFor(thread.root.id)}
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
      <CommentsPanel id={issue.id} attachmentsIssueId={attachmentsIssueId} />
    </div>
  );
}

function CommentsPanel({
  id,
  attachmentsIssueId,
}: {
  id: string;
  attachmentsIssueId?: string;
}) {
  const { data, isLoading, error } = useCommentsQuery(id);
  const { data: list } = useIssuesQuery();
  const post = usePostComment(id);
  const [, setSearchParams] = useSearchParams();
  const [draft, setDraft] = useState("");
  const [openReplyId, setOpenReplyId] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});

  const messages = data?.messages ?? [];
  const problems = data?.problems ?? [];
  const threads = useMemo(() => groupCommentThreads(messages), [messages]);

  const agentLive = useMemo(() => {
    const issue = list?.issues.find((item) => item.id === id);
    if (!issue) return false;
    return isInFlight(issue, list?.derived[id]);
  }, [id, list?.derived, list?.issues]);

  const send = () => {
    const body = draft.trim();
    if (!body || post.isPending) return;
    post.mutate({ role: COMPOSER_ROLE, body }, { onSuccess: () => setDraft("") });
  };

  const sendReply = (threadId: string) => {
    const body = (replyDrafts[threadId] ?? "").trim();
    if (!body || post.isPending) return;
    post.mutate(
      { role: COMPOSER_ROLE, body, replyTo: threadId },
      {
        onSuccess: () => {
          setReplyDrafts((prev) => {
            const next = { ...prev };
            delete next[threadId];
            return next;
          });
          setOpenReplyId(null);
        },
      },
    );
  };

  const replySlotFor = (threadId: string) => {
    if (openReplyId !== threadId) return undefined;
    return (
      <ThreadReplyComposer
        threadId={threadId}
        draft={replyDrafts[threadId] ?? ""}
        onDraftChange={(value) =>
          setReplyDrafts((prev) => ({ ...prev, [threadId]: value }))
        }
        onSend={() => sendReply(threadId)}
        pending={post.isPending}
      />
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
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
        ) : messages.length === 0 ? (
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
            onSeeInDiff={(threadId) =>
              setSearchParams((prev) => writeDiffThreadSearchParam(prev, threadId), {
                replace: true,
              })
            }
          />
        )}

        {post.isPending ? (
          <Shimmer label="Sending…" />
        ) : agentLive ? (
          <Shimmer />
        ) : null}

        <div className="flex min-w-0 shrink-0 items-end gap-2 border-t border-border pt-3">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Add a comment"
            title="Enter to send, Shift+Enter for a newline"
            aria-label="Add a comment"
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
    </SettingsCard>
  );
}
