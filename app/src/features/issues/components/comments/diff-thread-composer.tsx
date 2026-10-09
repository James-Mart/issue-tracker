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
  replaceReviewDraft,
  reviewDraft,
  reviewDraftHasText,
} from "@/features/reviews/lib/review-draft-storage";
import { usePostComment } from "../../api/mutations";
import {
  commentInputForComposer,
  composerDraftKey,
  isLineComposer,
  type NewDiffComposer,
  type NewLineComposer,
  type OpenDiffComposer,
  type QuoteDiffComposer,
} from "../../lib/diff-thread-anchor";
import { quoteComposerLabel } from "../../lib/quote-comment";
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
    (next: OpenDiffComposer, replacing: boolean) => {
      if (next.kind !== "quote" && !(next.kind === "reply" && replacing)) return;
      const key = composerDraftKey(issueId, next);
      replaceReviewDraft(key, next.kind === "quote" ? next.body : "");
    },
    [issueId],
  );

  const apply = useCallback(
    (current: OpenDiffComposer | null, next: OpenDiffComposer) => {
      if (current && composerDraftKey(issueId, current) !== composerDraftKey(issueId, next)) {
        clearReviewDraft(composerDraftKey(issueId, current));
      }
      seed(next, current != null);
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
      if (!open || !reviewDraftHasText(reviewDraft(composerDraftKey(issueId, open)))) {
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

function lineCaption(open: NewLineComposer): string {
  if (open.startLine !== undefined) {
    return `lines ${open.startLine}-${open.line}`;
  }
  return `line ${open.line}`;
}

export function DiffThreadComposer({
  target,
}: {
  target: OpenDiffComposer;
}) {
  const { issueId, send, close, allowQuestion } = useDiffComposer();
  const draftKey = composerDraftKey(issueId, target);
  const askQuestion = allowQuestion && target.kind === "new";
  const quote = target.kind === "quote" ? target : null;
  const quoteLabel = quote ? quoteComposerLabel(quote.anchor) : null;
  const lineTarget = target.kind === "new" && isLineComposer(target) ? target : null;
  const placeholder = quote
    ? "Add a comment"
    : target.kind !== "new"
      ? "Reply"
      : lineTarget?.startLine !== undefined
        ? `Comment on ${lineCaption(lineTarget)}`
        : "Add a comment";

  return (
    <div
      data-testid="diff-thread-composer"
      data-composer-kind={target.kind}
      data-draft-key={draftKey}
      className="flex flex-col gap-2 rounded-md border border-border bg-card px-3 py-2"
    >
      {quoteLabel ? (
        <QuoteComposerLabel label={quoteLabel} />
      ) : lineTarget ? (
        <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {lineCaption(lineTarget)}
        </p>
      ) : null}
      {target.kind === "new" && !askQuestion ? (
        <p className="text-sm text-foreground">Start a review thread</p>
      ) : null}
      <ReviewComposer
        draftKey={draftKey}
        placeholder={placeholder}
        submitLabel="Send"
        onSubmit={(body) => send(target, body)}
        onQuestion={askQuestion ? (body) => send(target, body, "question") : undefined}
        onCancel={close}
      />
    </div>
  );
}
