import { useCallback, useState } from "react";
import type { CommentInput } from "@server/schemas";
import {
  ReviewComposer,
  ReviewComposerDiscardDialog,
} from "@/features/reviews/components/review-composer";
import { replyDraftKey } from "@/features/reviews/lib/review-draft-key";
import {
  clearReviewDraft,
  replaceReviewDraft,
  reviewDraft,
  reviewDraftHasText,
} from "@/features/reviews/lib/review-draft-storage";
import {
  quoteCommentInput,
  quoteComposerLabel,
  type QuoteSource,
} from "../../lib/quote-comment";
import { QuoteComposerLabel } from "./quote-button";

export type ThreadComposerIntent =
  | { mode: "reply"; threadId: string }
  | ({ mode: "quote" } & QuoteSource);

type Slot = {
  intent: ThreadComposerIntent;
  pending: ThreadComposerIntent | null;
};

export function sameThreadIntent(
  a: ThreadComposerIntent,
  b: ThreadComposerIntent,
): boolean {
  if (a.mode !== b.mode || a.threadId !== b.threadId) return false;
  if (a.mode === "quote" && b.mode === "quote") return a.commentId === b.commentId;
  return true;
}

export function threadComposerCommentInput(
  intent: ThreadComposerIntent,
  body: string,
): CommentInput {
  if (intent.mode === "quote") return quoteCommentInput(body, intent.anchor);
  return { role: "human", body, replyTo: intent.threadId };
}

function seedThreadDraft(
  issueId: string,
  intent: ThreadComposerIntent,
  replacing: boolean,
): void {
  const key = replyDraftKey(issueId, intent.threadId);
  if (intent.mode === "quote") {
    replaceReviewDraft(key, intent.body);
    return;
  }
  if (replacing) replaceReviewDraft(key, "");
}

/** One reply/quote composer per thread. Switching a non-empty draft waits on discard. */
export function useThreadComposers(issueId: string) {
  const [slots, setSlots] = useState<Record<string, Slot>>({});

  const request = useCallback(
    (next: ThreadComposerIntent) => {
      const current = slots[next.threadId];
      if (current && sameThreadIntent(current.intent, next)) {
        if (!current.pending) return;
        setSlots((prev) => {
          const slot = prev[next.threadId];
          if (!slot) return prev;
          return { ...prev, [next.threadId]: { ...slot, pending: null } };
        });
        return;
      }
      const key = replyDraftKey(issueId, next.threadId);
      if (!current || !reviewDraftHasText(reviewDraft(key))) {
        seedThreadDraft(issueId, next, current != null);
        setSlots((prev) => ({
          ...prev,
          [next.threadId]: { intent: next, pending: null },
        }));
        return;
      }
      setSlots((prev) => {
        const slot = prev[next.threadId];
        if (!slot) return prev;
        return { ...prev, [next.threadId]: { ...slot, pending: next } };
      });
    },
    [issueId, slots],
  );

  const close = useCallback((threadId: string) => {
    setSlots((prev) => {
      if (!prev[threadId]) return prev;
      const next = { ...prev };
      delete next[threadId];
      return next;
    });
  }, []);

  const keep = useCallback((threadId: string) => {
    setSlots((prev) => {
      const slot = prev[threadId];
      if (!slot?.pending) return prev;
      return { ...prev, [threadId]: { ...slot, pending: null } };
    });
  }, []);

  const discard = useCallback(
    (threadId: string) => {
      const slot = slots[threadId];
      if (!slot?.pending) return;
      clearReviewDraft(replyDraftKey(issueId, threadId));
      seedThreadDraft(issueId, slot.pending, true);
      setSlots((prev) => ({
        ...prev,
        [threadId]: { intent: slot.pending!, pending: null },
      }));
    },
    [issueId, slots],
  );

  const pendingThreadId =
    Object.keys(slots).find((threadId) => slots[threadId]?.pending) ?? null;

  return { slots, request, close, keep, discard, pendingThreadId };
}

export function ThreadComposerFields({
  issueId,
  intent,
  onSubmit,
  onCancel,
}: {
  issueId: string;
  intent: ThreadComposerIntent;
  onSubmit: (body: string) => void;
  onCancel: () => void;
}) {
  const quote = intent.mode === "quote";
  const label = quote ? quoteComposerLabel(intent.anchor) : undefined;
  return (
    <div
      data-testid={quote ? "comment-quote-composer" : "comment-log-reply-composer"}
      data-thread-id={intent.threadId}
      data-comment-id={quote ? intent.commentId : undefined}
    >
      {label ? <QuoteComposerLabel label={label} className="mb-2" /> : null}
      <ReviewComposer
        draftKey={replyDraftKey(issueId, intent.threadId)}
        placeholder={quote ? "Add a comment" : "Reply"}
        submitLabel="Send"
        autoFocus={quote}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    </div>
  );
}

export function ThreadComposerDiscard({
  threadId,
  onKeep,
  onDiscard,
}: {
  threadId: string | null;
  onKeep: (threadId: string) => void;
  onDiscard: (threadId: string) => void;
}) {
  return (
    <ReviewComposerDiscardDialog
      open={threadId != null}
      onKeep={() => {
        if (threadId) onKeep(threadId);
      }}
      onDiscard={() => {
        if (threadId) onDiscard(threadId);
      }}
    />
  );
}
