import { useCallback, useRef, useState } from "react";
import type { CommentInput } from "@server/schemas";
import { ReviewComposer } from "@/features/reviews/components/review-composer";
import { quoteDraftKey, replyDraftKey } from "@/features/reviews/lib/review-draft-key";
import {
  quoteBlockquote,
  quoteCommentInput,
  quoteComposerLabel,
  seedQuoteDraft,
  type QuoteSource,
} from "../../lib/quote-comment";
import { QuoteComposerLabel } from "./quote-button";

export type ThreadComposerIntent =
  | { mode: "reply"; threadId: string }
  | ({ mode: "quote" } & QuoteSource);

type OpenThreadComposers = {
  reply: boolean;
  quote: QuoteSource | null;
};

export function threadComposerCommentInput(
  intent: ThreadComposerIntent,
  body: string,
): CommentInput {
  if (intent.mode === "quote") return quoteCommentInput(body, intent.anchor);
  return { role: "human", body, replyTo: intent.threadId };
}

/** Reply and quote composers for one issue. A quote draft is keyed by the quoted comment. */
export function useThreadComposers(issueId: string) {
  const [slots, setSlots] = useState<Record<string, OpenThreadComposers>>({});
  const slotsRef = useRef(slots);
  slotsRef.current = slots;

  const request = useCallback(
    (next: ThreadComposerIntent) => {
      if (next.mode === "reply") {
        setSlots((prev) => {
          const current = prev[next.threadId];
          if (current?.reply) return prev;
          return {
            ...prev,
            [next.threadId]: { reply: true, quote: current?.quote ?? null },
          };
        });
        return;
      }
      const open = slotsRef.current[next.threadId]?.quote;
      if (open?.commentId !== next.commentId) seedQuoteDraft(issueId, next);
      setSlots((prev) => {
        const current = prev[next.threadId];
        if (current?.quote?.commentId === next.commentId) return prev;
        return {
          ...prev,
          [next.threadId]: { reply: current?.reply ?? false, quote: next },
        };
      });
    },
    [issueId],
  );

  const close = useCallback((threadId: string, mode: "reply" | "quote") => {
    setSlots((prev) => {
      const current = prev[threadId];
      if (!current) return prev;
      const next: OpenThreadComposers =
        mode === "reply"
          ? { ...current, reply: false }
          : { ...current, quote: null };
      if (!next.reply && next.quote == null) {
        const rest = { ...prev };
        delete rest[threadId];
        return rest;
      }
      return { ...prev, [threadId]: next };
    });
  }, []);

  return { slots, request, close };
}

export function ThreadComposerFields({
  issueId,
  threadId,
  onSubmit,
  onCancel,
}: {
  issueId: string;
  threadId: string;
  onSubmit: (body: string) => void;
  onCancel: () => void;
}) {
  return (
    <div
      data-testid="comment-log-reply-composer"
      data-thread-id={threadId}
      className="min-w-0"
    >
      <ReviewComposer
        draftKey={replyDraftKey(issueId, threadId)}
        placeholder="Reply"
        submitLabel="Send"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    </div>
  );
}

/** New-thread composer card, placed under the quoted thread rather than inside it. */
export function QuoteThreadComposer({
  issueId,
  source,
  onSubmit,
  onCancel,
}: {
  issueId: string;
  source: QuoteSource;
  onSubmit: (body: string) => void;
  onCancel: () => void;
}) {
  return (
    <div
      data-testid="comment-quote-card"
      className="mt-3 flex min-w-0 flex-col rounded-md border border-border bg-card px-3 py-2"
    >
      <div
        data-testid="comment-quote-composer"
        data-thread-id={source.threadId}
        data-comment-id={source.commentId}
        className="min-w-0"
      >
        <QuoteComposerLabel
          label={quoteComposerLabel(source.anchor, source.outdated === true)}
          className="mb-2"
        />
        <ReviewComposer
          draftKey={quoteDraftKey(issueId, source.commentId)}
          placeholder="Add a comment"
          submitLabel="Send"
          caretAtEnd
          baseline={quoteBlockquote(source.body)}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      </div>
    </div>
  );
}
