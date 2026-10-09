import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronRight, Send } from "lucide-react";
import { useLocation, useSearchParams } from "react-router-dom";
import type { IssueDetail, ThreadEventRequest } from "@server/schemas";
import { ShellFaultDetail, ShellState } from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ReviewComposer } from "@/features/reviews/components/review-composer";
import { conversationDraftKey } from "@/features/reviews/lib/review-draft-key";
import { useCommentThreads, useCommentsQuery } from "../../api/queries";
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
import { quoteSource } from "../../lib/quote-comment";
import { isInFlight } from "../../lib/derived";
import { scrollCommentInPanel } from "../../lib/issue-change-focus-thread";
import {
  hashCommentTarget,
  readDiffThreadSearchParam,
  writeDiffThreadSearchParam,
} from "../../lib/issue-detail-tabs";
import {
  commentInThreads,
  commentListEntries,
  runIdContaining,
  type CommentListEntry,
} from "../../lib/settled-comment-runs";
import { cn } from "@/lib/utils/cn";
import { SettingsCard } from "../detail-section";
import { DeliverableMessage } from "./comment-delivery";
import { CommentThread } from "./comment-thread";
import {
  ThreadComposerDiscard,
  ThreadComposerFields,
  threadComposerCommentInput,
  useThreadComposers,
  type ThreadComposerIntent,
} from "./thread-composer";
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

function useCommentNavigationTarget(): string | null {
  const [params] = useSearchParams();
  const { hash } = useLocation();
  return hashCommentTarget(hash) ?? readDiffThreadSearchParam(params);
}

function CommentList({
  threads,
  issueId,
  attachmentsIssueId,
  replySlotFor,
  quoteSlotFor,
  onReply,
  onQuote,
  onSeeInDiff,
  storyComposer,
  onThreadEvent,
  eventPending,
}: {
  threads: CommentThreadData[];
  issueId: string;
  attachmentsIssueId?: string;
  replySlotFor: (threadId: string) => ReactNode;
  quoteSlotFor: (thread: CommentThreadData) => {
    commentId: string;
    node: ReactNode;
  } | undefined;
  onReply: (threadId: string) => void;
  onQuote?: (thread: CommentThreadData, commentId: string, body: string) => void;
  onSeeInDiff: (threadId: string) => void;
  storyComposer: boolean;
  onThreadEvent: (
    threadId: string,
    event: ThreadEventRequest["event"],
  ) => void;
  eventPending: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [params] = useSearchParams();
  const tab = params.get("tab");
  const navigationId = useCommentNavigationTarget();
  const located =
    storyComposer && navigationId ? commentInThreads(threads, navigationId) : null;
  const entries = storyComposer
    ? commentListEntries(threads)
    : threads.map((thread): CommentListEntry => ({ kind: "thread", thread }));
  const targetRunId = located ? runIdContaining(entries, located.thread.root.id) : null;
  const targetCommentId = located?.commentId ?? null;
  const targetThreadId = located?.thread.root.id ?? null;
  const revealThreadId =
    targetRunId &&
    located &&
    isQuestionThread(located.thread) &&
    located.thread.state === "dismissed"
      ? located.thread.root.id
      : null;
  const [openRuns, setOpenRuns] = useState<ReadonlySet<string>>(() => new Set());
  const scrolledTarget = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (!targetRunId || !targetCommentId || !targetThreadId) return;
    const list = listRef.current;
    if (!list || list.closest("[inert]")) return;
    const token = `${targetRunId}:${targetCommentId}`;
    if (!openRuns.has(targetRunId)) {
      // The user closed this run after it was opened for the target. Leave it closed.
      if (scrolledTarget.current === token) return;
      setOpenRuns((prev) => {
        if (prev.has(targetRunId)) return prev;
        const next = new Set(prev);
        next.add(targetRunId);
        return next;
      });
      return;
    }
    if (scrolledTarget.current === token) return;
    scrolledTarget.current = token;
    return scrollCommentInPanel(list, targetCommentId, targetThreadId, {
      block: "nearest",
    });
  }, [openRuns, tab, targetCommentId, targetRunId, targetThreadId]);

  const toggleRun = (runId: string) => {
    setOpenRuns((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  };

  const renderThread = (thread: CommentThreadData) => {
    const quoteSlot = quoteSlotFor(thread);
    if (isPlainNote(thread)) {
      return (
        <DeliverableMessage
          message={thread.root}
          attachmentsIssueId={attachmentsIssueId}
          onQuote={
            onQuote && thread.root.delivery === undefined
              ? () => onQuote(thread, thread.root.id, thread.root.body)
              : undefined
          }
          footer={quoteSlot?.commentId === thread.root.id ? quoteSlot.node : undefined}
        />
      );
    }
    return (
      <CommentThread
        thread={thread}
        issueId={issueId}
        showAnchorContext
        resolvePending={eventPending}
        reveal={revealThreadId === thread.root.id}
        onSeeInDiff={
          thread.root.anchor ? () => onSeeInDiff(thread.root.id) : undefined
        }
        onReply={() => onReply(thread.root.id)}
        onQuote={
          onQuote ? (comment) => onQuote(thread, comment.id, comment.body) : undefined
        }
        replySlot={replySlotFor(thread.root.id)}
        quoteSlot={quoteSlot?.node}
        quoteCommentId={quoteSlot?.commentId}
        {...(storyComposer && (isQuestionThread(thread) || thread.converted)
          ? threadStateActions(thread, (event) => onThreadEvent(thread.root.id, event))
          : {})}
      />
    );
  };

  let lastDay = "";
  const markerFor = (at: string) => {
    const key = commentDayKey(at);
    const show = key !== lastDay;
    lastDay = key;
    return show ? <Marker>{commentDayLabel(at)}</Marker> : null;
  };

  return (
    <div ref={listRef} className="flex flex-col gap-3">
      {entries.map((entry) => {
        if (entry.kind === "thread") {
          return (
            <div
              key={entry.thread.root.id}
              data-log-root={entry.thread.root.id}
              className="flex flex-col"
            >
              {markerFor(entry.thread.root.at)}
              {renderThread(entry.thread)}
            </div>
          );
        }
        const first = entry.threads[0];
        const lead = markerFor(first.root.at);
        const open = openRuns.has(entry.id);
        const rest = entry.threads.slice(1).map((thread) => ({
          thread,
          marker: open ? markerFor(thread.root.at) : null,
        }));
        return (
          <div key={entry.id} className="flex flex-col">
            {lead}
            <section
              data-testid="settled-comment-run"
              data-run-id={entry.id}
              data-expanded={open ? "" : undefined}
              className="rounded-md border border-border bg-card"
            >
              <button
                type="button"
                aria-expanded={open}
                data-testid="settled-comment-run-toggle"
                onClick={() => toggleRun(entry.id)}
                className="flex w-full items-center gap-1.5 rounded-md px-3 py-1.5 text-left text-sm text-foreground hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch:min-h-11"
              >
                <ChevronRight
                  className={cn(
                    "h-3.5 w-3.5 shrink-0 text-muted-foreground motion-safe:transition-transform",
                    open && "rotate-90",
                  )}
                  aria-hidden
                />
                <span>{entry.title}</span>
              </button>
              {open ? (
                <div className="flex flex-col gap-3 px-3 pb-3">
                  <div data-log-root={first.root.id} className="flex flex-col">
                    {renderThread(first)}
                  </div>
                  {rest.map(({ thread, marker }) => (
                    <div
                      key={thread.root.id}
                      data-log-root={thread.root.id}
                      className="flex flex-col"
                    >
                      {marker}
                      {renderThread(thread)}
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
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
        issue={issue}
        attachmentsIssueId={attachmentsIssueId}
        storyComposer={issue.kind === "story"}
      />
    </div>
  );
}

function CommentsPanel({
  issue,
  attachmentsIssueId,
  storyComposer,
}: {
  issue: IssueDetail;
  attachmentsIssueId?: string;
  storyComposer: boolean;
}) {
  const id = issue.id;
  const { isLoading, error } = useCommentsQuery(id);
  const { threads, problems } = useCommentThreads(id);
  const post = usePostComment(id);
  const events = usePostThreadEvent(id);
  const [, setSearchParams] = useSearchParams();
  const [draft, setDraft] = useState("");
  const [openReplyId, setOpenReplyId] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const composers = useThreadComposers(id);

  const agentLive = isInFlight(issue);

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

  const submitStoryComposer = (intent: ThreadComposerIntent, body: string) => {
    post(threadComposerCommentInput(intent, body));
    composers.close(intent.threadId);
  };

  const replySlotFor = (threadId: string) => {
    if (storyComposer) {
      const slot = composers.slots[threadId];
      if (slot?.intent.mode !== "reply") return undefined;
      return (
        <ThreadComposerFields
          issueId={id}
          intent={slot.intent}
          onSubmit={(body) => submitStoryComposer(slot.intent, body)}
          onCancel={() => composers.close(threadId)}
        />
      );
    }
    if (openReplyId !== threadId) return undefined;
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
  };

  const quoteSlotFor = (thread: CommentThreadData) => {
    if (!storyComposer) return undefined;
    const slot = composers.slots[thread.root.id];
    if (slot?.intent.mode !== "quote") return undefined;
    return {
      commentId: slot.intent.commentId,
      node: (
        <ThreadComposerFields
          issueId={id}
          intent={slot.intent}
          onSubmit={(body) => submitStoryComposer(slot.intent, body)}
          onCancel={() => composers.close(thread.root.id)}
        />
      ),
    };
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
            quoteSlotFor={quoteSlotFor}
            onReply={(threadId) => {
              if (storyComposer) {
                composers.request({ mode: "reply", threadId });
                return;
              }
              setOpenReplyId(threadId);
            }}
            onQuote={
              storyComposer
                ? (thread, commentId, body) =>
                    composers.request({
                      mode: "quote",
                      ...quoteSource(
                        thread.root.id,
                        { id: commentId, body },
                        thread.root.anchor,
                      ),
                    })
                : undefined
            }
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

        {storyComposer ? (
          <ThreadComposerDiscard
            threadId={composers.pendingThreadId}
            onKeep={composers.keep}
            onDiscard={composers.discard}
          />
        ) : null}

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
