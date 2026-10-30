import { Fragment, type ReactNode } from "react";
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
  QuoteThreadComposer,
  ThreadComposerFields,
  threadComposerCommentInput,
  useThreadComposers,
  type ThreadComposerIntent,
} from "@/features/issues/components/comments/thread-composer";
import { isPlainNote, threadStateActions } from "@/features/issues/lib/comment-threads";
import {
  quoteComposerAmongThreads,
  quoteComposerForThread,
  quoteDiffComposer,
} from "@/features/issues/lib/diff-thread-anchor";
import { quoteSource } from "@/features/issues/lib/quote-comment";
import { SETTINGS_HEADING_CLASS } from "@/features/issues/components/detail-section";
import { useReviewTranscriptLinks } from "./review-transcript-link";

/** Review thread on the review workbench: reply, quote, resolve, and unresolve. */
export function ReviewThread({
  thread,
  reviewId,
  inline = false,
  showAnchorContext = false,
  collapse,
  onSeeInDiff,
  highlighted = false,
}: {
  thread: CommentThreadData;
  reviewId: string;
  inline?: boolean;
  showAnchorContext?: boolean;
  collapse?: "resolved" | "outdated";
  onSeeInDiff?: () => void;
  /** The thread a link landed on: outlined, and opened if it collapses. */
  highlighted?: boolean;
}) {
  const post = usePostComment(reviewId);
  const edit = useEditComment(reviewId);
  const events = usePostThreadEvent(reviewId);
  const diff = useOptionalDiffComposer();
  const composers = useThreadComposers(reviewId);
  const transcripts = useReviewTranscriptLinks();
  const researcherConversationId = transcripts?.researcherConversationId(thread.root.id);
  const openResearcher =
    transcripts && researcherConversationId
      ? () => transcripts.openResearcher(thread.root.id, researcherConversationId)
      : undefined;
  const threadId = thread.root.id;
  const open = composers.slots[threadId];

  const submitComposer = (intent: ThreadComposerIntent, body: string) => {
    post(threadComposerCommentInput(intent, body));
    composers.close(threadId, intent.mode);
  };

  const diffReply = diff?.open?.kind === "reply" && diff.open.threadId === threadId;
  const localQuote = !diff ? (open?.quote ?? null) : null;

  return (
    <>
      <CommentThread
        thread={thread}
        issueId={reviewId}
        inline={inline}
        showAnchorContext={showAnchorContext}
        collapse={collapse}
        onSeeInDiff={onSeeInDiff}
        highlighted={highlighted}
        reveal={highlighted}
        onReply={
          isPlainNote(thread)
            ? undefined
            : () => {
                if (diff) diff.openReply(threadId);
                else composers.request({ mode: "reply", threadId });
              }
        }
        onQuote={(comment) => {
          const source = quoteSource(
            threadId,
            comment,
            thread.root.anchor,
            thread.root.outdated === true,
          );
          if (diff) diff.openQuote(quoteDiffComposer(source));
          else composers.request({ mode: "quote", ...source });
        }}
        replySlot={
          diffReply ? (
            <DiffThreadComposer target={{ kind: "reply", threadId }} />
          ) : !diff && open?.reply ? (
            <ThreadComposerFields
              issueId={reviewId}
              threadId={threadId}
              onSubmit={(body) =>
                submitComposer({ mode: "reply", threadId }, body)
              }
              onCancel={() => composers.close(threadId, "reply")}
            />
          ) : undefined
        }
        resolvePending={events.isPending}
        onEdit={async (commentId, body) => {
          await edit.mutateAsync({ commentId, body });
        }}
        {...threadStateActions(thread, (event) =>
          events.mutate({ threadId, event }),
        )}
        onOpenResearcher={openResearcher}
      />
      {localQuote ? (
        <QuoteThreadComposer
          key={localQuote.commentId}
          issueId={reviewId}
          source={localQuote}
          onSubmit={(body) =>
            submitComposer({ mode: "quote", ...localQuote }, body)
          }
          onCancel={() => composers.close(threadId, "quote")}
        />
      ) : null}
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
  const diff = useOptionalDiffComposer();
  const quote = quoteComposerAmongThreads(diff?.open ?? null, threads);
  const slot = composer ?? (quote ? <DiffThreadComposer target={quote} /> : null);
  if (threads.length === 0 && slot == null) return null;
  return (
    // Annotations slot into the diff's shadow tree and would inherit its monospace code font.
    <div
      data-testid="review-line-threads"
      className="flex flex-col gap-2 px-3 py-2 font-sans"
    >
      {threads.map((thread) => (
        <ReviewThread key={thread.root.id} thread={thread} reviewId={reviewId} inline />
      ))}
      {slot}
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
  const diff = useOptionalDiffComposer();
  const open = diff?.open ?? null;
  if (threads.length === 0) return null;
  return (
    <section
      data-testid="review-outdated-threads"
      aria-label="Outdated threads"
      className="flex flex-col gap-2 border-t border-border px-3 py-2"
    >
      <p className={SETTINGS_HEADING_CLASS}>Outdated</p>
      {threads.map((thread) => {
        const quote = quoteComposerForThread(open, thread.root.id);
        return (
          <Fragment key={thread.root.id}>
            <ReviewThread
              thread={thread}
              reviewId={reviewId}
              inline
              showAnchorContext
              collapse="outdated"
            />
            {quote ? <DiffThreadComposer target={quote} /> : null}
          </Fragment>
        );
      })}
    </section>
  );
}
