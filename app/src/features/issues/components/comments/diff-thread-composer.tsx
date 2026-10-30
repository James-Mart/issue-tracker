import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ReviewComposer, ReviewComposerDiscardDialog } from "@/features/reviews/components/review-composer";
import {
  clearReviewDraft,
  reviewDraft,
  reviewDraftHasText,
} from "@/features/reviews/lib/review-draft-storage";
import { usePostComment } from "../../api/mutations";
import { isLineAnchor } from "../../lib/comment-anchor";
import { formatAnchorLineLabel } from "../../lib/comment-threads";
import {
  commentInputForComposer,
  composerDraftKey,
  isLineComposer,
  type NewDiffComposer,
  type OpenDiffComposer,
  type QuoteDiffComposer,
} from "../../lib/diff-thread-anchor";
import { quoteBlockquote, quoteComposerLabel, seedQuoteDraft } from "../../lib/quote-comment";
import { QuoteComposerLabel } from "./quote-button";

type DiffComposerContextValue = {
  issueId: string;
  commitSha: string;
  allowQuestion: boolean;
  open: OpenDiffComposer | null;
  openNew: (anchor: NewDiffComposer) => void;
  openReply: (threadId: string) => void;
  openQuote: (quote: QuoteDiffComposer) => void;
  close: () => void;
  send: (open: OpenDiffComposer, body: string, kind?: "question") => void;
};

const DiffComposerContext = createContext<DiffComposerContextValue | null>(
  null,
);

export function DiffComposerProvider({
  issueId,
  commitSha,
  allowQuestion = false,
  children,
}: {
  issueId: string;
  commitSha: string;
  /** Story composers offer Ask a question beside Send. */
  allowQuestion?: boolean;
  children: ReactNode;
}) {
  const post = usePostComment(issueId);
  const [open, setOpen] = useState<OpenDiffComposer | null>(null);
  const [pending, setPending] = useState<OpenDiffComposer | null>(null);

  const seed = useCallback(
    (next: OpenDiffComposer) => {
      if (next.kind !== "quote") return;
      seedQuoteDraft(issueId, next);
    },
    [issueId],
  );

  const apply = useCallback(
    (current: OpenDiffComposer | null, next: OpenDiffComposer) => {
      if (
        current &&
        !quoteKeepsReplyDraft(current, next) &&
        composerDraftKey(issueId, current) !== composerDraftKey(issueId, next)
      ) {
        clearReviewDraft(composerDraftKey(issueId, current));
      }
      seed(next);
      setPending(null);
      setOpen(next);
    },
    [issueId, seed],
  );

  const requestOpen = useCallback(
    (next: OpenDiffComposer) => {
      if (open && sameDiffComposer(open, next)) {
        if (pending) setPending(null);
        return;
      }
      if (
        !open ||
        quoteKeepsReplyDraft(open, next) ||
        !composerHoldsUnsentText(issueId, open)
      ) {
        apply(open, next);
        return;
      }
      setPending(next);
    },
    [apply, issueId, open, pending],
  );

  const openNew = useCallback(
    (anchor: NewDiffComposer) => {
      requestOpen(anchor);
    },
    [requestOpen],
  );
  const openReply = useCallback(
    (threadId: string) => {
      requestOpen({ kind: "reply", threadId });
    },
    [requestOpen],
  );
  const openQuote = useCallback(
    (quote: QuoteDiffComposer) => {
      requestOpen(quote);
    },
    [requestOpen],
  );
  const close = useCallback(() => {
    setPending(null);
    setOpen(null);
  }, []);
  const keepDraft = useCallback(() => setPending(null), []);
  const discardDraft = useCallback(() => {
    if (!open || !pending) return;
    apply(open, pending);
  }, [apply, open, pending]);
  const send = useCallback(
    (target: OpenDiffComposer, body: string, kind?: "question") => {
      post(commentInputForComposer(target, body, commitSha, kind));
      setPending(null);
      setOpen(null);
    },
    [commitSha, post],
  );

  const value = useMemo(
    () => ({
      issueId,
      commitSha,
      allowQuestion,
      open,
      openNew,
      openReply,
      openQuote,
      close,
      send,
    }),
    [issueId, commitSha, allowQuestion, open, openNew, openReply, openQuote, close, send],
  );

  return (
    <DiffComposerContext.Provider value={value}>
      {children}
      <ReviewComposerDiscardDialog
        open={pending != null}
        onKeep={keepDraft}
        onDiscard={discardDraft}
      />
    </DiffComposerContext.Provider>
  );
}

/** Quote closes the reply composer and leaves that reply draft stored. */
function quoteKeepsReplyDraft(
  current: OpenDiffComposer | null,
  next: OpenDiffComposer,
): boolean {
  return current?.kind === "reply" && next.kind === "quote";
}

/** A seeded blockquote is the quote baseline, not text the user would lose. */
function composerHoldsUnsentText(issueId: string, open: OpenDiffComposer): boolean {
  const draft = reviewDraft(composerDraftKey(issueId, open));
  if (!reviewDraftHasText(draft)) return false;
  if (open.kind === "quote" && draft === quoteBlockquote(open.body)) return false;
  return true;
}

function sameDiffComposer(a: OpenDiffComposer, b: OpenDiffComposer): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "reply" && b.kind === "reply") return a.threadId === b.threadId;
  if (a.kind === "quote" && b.kind === "quote") {
    return a.threadId === b.threadId && a.commentId === b.commentId;
  }
  if (a.kind === "new" && b.kind === "new") {
    if (isLineComposer(a) !== isLineComposer(b)) return false;
    if (!isLineComposer(a) || !isLineComposer(b)) return a.path === b.path;
    return (
      a.path === b.path &&
      a.side === b.side &&
      a.line === b.line &&
      a.startLine === b.startLine
    );
  }
  return false;
}

export function useOptionalDiffComposer(): DiffComposerContextValue | null {
  return useContext(DiffComposerContext);
}

export function useDiffComposer(): DiffComposerContextValue {
  const value = useOptionalDiffComposer();
  if (!value) {
    throw new Error("useDiffComposer must be used under DiffComposerProvider");
  }
  return value;
}

/** Current line quotes use the fresh-comment caption. Outdated and file quotes keep theirs. */
function lineAnchorForCaption(
  target: OpenDiffComposer,
): { line: number; startLine?: number } | null {
  if (target.kind === "new" && isLineComposer(target)) return target;
  if (target.kind !== "quote" || target.outdated === true) return null;
  const anchor = target.anchor;
  if (!anchor || !isLineAnchor(anchor)) return null;
  return anchor;
}

function diffComposerChrome(target: OpenDiffComposer): {
  quoteLabel: string | null;
  lineLabel: string | null;
  placeholder: string;
} {
  const quote = target.kind === "quote" ? target : null;
  const lineAnchor = lineAnchorForCaption(target);
  const lineLabel = lineAnchor ? formatAnchorLineLabel(lineAnchor) : null;
  const ranged =
    lineAnchor != null &&
    lineAnchor.startLine !== undefined &&
    lineAnchor.startLine !== lineAnchor.line;
  return {
    quoteLabel:
      quote && lineAnchor == null
        ? quoteComposerLabel(quote.anchor, quote.outdated === true)
        : null,
    lineLabel,
    placeholder:
      target.kind === "reply"
        ? "Reply"
        : ranged && lineLabel
          ? `Comment on ${lineLabel}`
          : "Add a comment",
  };
}

export function DiffThreadComposer({ target }: { target: OpenDiffComposer }) {
  const { issueId, send, close, allowQuestion } = useDiffComposer();
  const draftKey = composerDraftKey(issueId, target);
  const askQuestion = allowQuestion && (target.kind === "new" || target.kind === "quote");
  const quote = target.kind === "quote" ? target : null;
  const { quoteLabel, lineLabel, placeholder } = diffComposerChrome(target);

  return (
    <div
      data-testid="diff-thread-composer"
      data-composer-kind={target.kind}
      data-draft-key={draftKey}
      className="flex flex-col gap-2 rounded-md border border-border bg-card px-3 py-2"
    >
      {quoteLabel ? (
        <QuoteComposerLabel label={quoteLabel} />
      ) : lineLabel ? (
        <p className="font-mono text-[11px] tabular-nums text-muted-foreground">{lineLabel}</p>
      ) : null}
      {target.kind === "new" && !askQuestion ? (
        <p className="text-sm text-foreground">Start a review thread</p>
      ) : null}
      <ReviewComposer
        draftKey={draftKey}
        placeholder={placeholder}
        submitLabel="Send"
        caretAtEnd={quote != null}
        baseline={quote ? quoteBlockquote(quote.body) : undefined}
        onSubmit={(body) => send(target, body)}
        onQuestion={askQuestion ? (body) => send(target, body, "question") : undefined}
        onCancel={close}
      />
    </div>
  );
}
