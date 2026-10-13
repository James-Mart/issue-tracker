import type { ReactNode } from "react";
import type { CommentThread as CommentThreadData } from "@/features/issues/lib/comment-threads";
import {
  useEditComment,
  usePostComment,
  usePostThreadEvent,
} from "@/features/issues/api/mutations";
import { CommentThread } from "@/features/issues/components/comments/comment-thread";
import {
  DiffThreadComposer,
  useOptionalDiffComposer,
} from "@/features/issues/components/comments/diff-thread-composer";
import {
  ThreadComposerDiscard,
  ThreadComposerFields,
  threadComposerCommentInput,
  useThreadComposers,
} from "@/features/issues/components/comments/thread-composer";
import { isPlainNote, threadStateActions } from "@/features/issues/lib/comment-threads";
import { quoteDiffComposer } from "@/features/issues/lib/diff-thread-anchor";
import { quoteSource } from "@/features/issues/lib/quote-comment";
import { SETTINGS_HEADING_CLASS } from "@/features/issues/components/detail-section";

/** Review thread on the review workbench: reply, quote, resolve, and unresolve. */
export function ReviewThread({
  thread,
  reviewId,
  inline = false,
  showAnchorContext = false,
  collapse,
  onSeeInDiff,
}: {
  thread: CommentThreadData;
  reviewId: string;
  inline?: boolean;
  showAnchorContext?: boolean;
  collapse?: "resolved" | "outdated";
  onSeeInDiff?: () => void;
}) {
  const post = usePostComment(reviewId);
  const edit = useEditComment(reviewId);
  const events = usePostThreadEvent(reviewId);
  const diff = useOptionalDiffComposer();
  const composers = useThreadComposers(reviewId);
  const slot = composers.slots[thread.root.id];
  const threadId = thread.root.id;

  const sendLocal = (body: string) => {
    if (!slot) return;
    post(threadComposerCommentInput(slot.intent, body));
    composers.close(threadId);
  };

  const diffReply = diff?.open?.kind === "reply" && diff.open.threadId === threadId;
  const diffQuote =
    diff?.open?.kind === "quote" && diff.open.threadId === threadId ? diff.open : null;
  const localQuote = !diff && slot?.intent.mode === "quote" ? slot.intent : null;

  return (
    <>
      <CommentThread
        thread={thread}
        issueId={reviewId}
        inline={inline}
        showAnchorContext={showAnchorContext}
        collapse={collapse}
        onSeeInDiff={onSeeInDiff}
        onReply={
          isPlainNote(thread)
            ? undefined
            : () => {
                if (diff) diff.openReply(threadId);
                else composers.request({ mode: "reply", threadId });
              }
        }
        onQuote={(comment) => {
          const source = quoteSource(threadId, comment, thread.root.anchor);
          if (diff) diff.openQuote(quoteDiffComposer(source));
          else composers.request({ mode: "quote", ...source });
        }}
        replySlot={
          diffReply ? (
            <DiffThreadComposer target={{ kind: "reply", threadId }} />
          ) : !diff && slot?.intent.mode === "reply" ? (
            <ThreadComposerFields
              issueId={reviewId}
              intent={slot.intent}
              onSubmit={sendLocal}
              onCancel={() => composers.close(threadId)}
            />
          ) : undefined
        }
        quoteSlot={
          diffQuote ? (
            <DiffThreadComposer target={diffQuote} />
          ) : localQuote ? (
            <ThreadComposerFields
              issueId={reviewId}
              intent={localQuote}
              onSubmit={sendLocal}
              onCancel={() => composers.close(threadId)}
            />
          ) : undefined
        }
        quoteCommentId={diffQuote?.commentId ?? localQuote?.commentId}
        resolvePending={events.isPending}
        onEdit={async (commentId, body) => {
          await edit.mutateAsync({ commentId, body });
        }}
        {...threadStateActions(thread, (event) =>
          events.mutate({ threadId, event }),
        )}
      />
      {diff ? null : (
        <ThreadComposerDiscard
          threadId={composers.pendingThreadId}
          onKeep={composers.keep}
          onDiscard={composers.discard}
        />
      )}
    </>
  );
}

export function ReviewLineThreads({
  threads,
  reviewId,
  composer,
}: {
  threads: CommentThreadData[];
  reviewId: string;
  /** New-thread composer open on this line. */
  composer?: ReactNode;
}) {
  if (threads.length === 0 && composer == null) return null;
  return (
    // Annotations slot into the diff's shadow tree and would inherit its monospace code font.
    <div
      data-testid="review-line-threads"
      className="flex flex-col gap-2 px-3 py-2 font-sans"
    >
      {threads.map((thread) => (
        <ReviewThread key={thread.root.id} thread={thread} reviewId={reviewId} inline />
      ))}
      {composer}
    </div>
  );
}

/** All changes: threads whose anchor drifted, kept in their file card below the code. */
export function ReviewOutdatedThreads({
  threads,
  reviewId,
}: {
  threads: CommentThreadData[];
  reviewId: string;
}) {
  if (threads.length === 0) return null;
  return (
    <section
      data-testid="review-outdated-threads"
      aria-label="Outdated threads"
      className="flex flex-col gap-2 border-t border-border px-3 py-2"
    >
      <p className={SETTINGS_HEADING_CLASS}>Outdated</p>
      {threads.map((thread) => (
        <ReviewThread
          key={thread.root.id}
          thread={thread}
          reviewId={reviewId}
          inline
          showAnchorContext
          collapse="outdated"
        />
      ))}
    </section>
  );
}
