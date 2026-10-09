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

/** Story thread on the review workbench: reply, quote, resolve, and unresolve. */
export function ReviewThread({
  thread,
  storyId,
  inline = false,
  showAnchorContext = false,
  collapse,
  onSeeInDiff,
}: {
  thread: CommentThreadData;
  storyId: string;
  inline?: boolean;
  showAnchorContext?: boolean;
  collapse?: "resolved" | "outdated";
  onSeeInDiff?: () => void;
}) {
  const post = usePostComment(storyId);
  const edit = useEditComment(storyId);
  const events = usePostThreadEvent(storyId);
  const diff = useOptionalDiffComposer();
  const composers = useThreadComposers(storyId);
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
        issueId={storyId}
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
              issueId={storyId}
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
              issueId={storyId}
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
  storyId,
  composer,
}: {
  threads: CommentThreadData[];
  storyId: string;
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
        <ReviewThread key={thread.root.id} thread={thread} storyId={storyId} inline />
      ))}
      {composer}
    </div>
  );
}

/** All changes: threads whose anchor drifted, kept in their file card below the code. */
export function ReviewOutdatedThreads({
  threads,
  storyId,
}: {
  threads: CommentThreadData[];
  storyId: string;
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
          storyId={storyId}
          inline
          showAnchorContext
          collapse="outdated"
        />
      ))}
    </section>
  );
}
