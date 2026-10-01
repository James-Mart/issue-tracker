import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ReviewComposer } from "@/features/reviews/components/review-composer";
import { usePostComment } from "../../api/mutations";
import {
  commentInputForComposer,
  composerDraftKey,
  isLineComposer,
  type NewDiffComposer,
  type NewLineComposer,
  type OpenDiffComposer,
} from "../../lib/diff-thread-anchor";

type DiffComposerContextValue = {
  issueId: string;
  commitSha: string;
  allowQuestion: boolean;
  open: OpenDiffComposer | null;
  openNew: (anchor: NewDiffComposer) => void;
  openReply: (threadId: string) => void;
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

  const openNew = useCallback(
    (anchor: NewDiffComposer) => {
      setOpen(anchor);
    },
    [],
  );
  const openReply = useCallback((threadId: string) => {
    setOpen({ kind: "reply", threadId });
  }, []);
  const close = useCallback(() => setOpen(null), []);
  const send = useCallback(
    (target: OpenDiffComposer, body: string, kind?: "question") => {
      post(commentInputForComposer(target, body, commitSha, kind));
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
      close,
      send,
    }),
    [issueId, commitSha, allowQuestion, open, openNew, openReply, close, send],
  );

  return (
    <DiffComposerContext.Provider value={value}>
      {children}
    </DiffComposerContext.Provider>
  );
}

export function useDiffComposer(): DiffComposerContextValue {
  const value = useContext(DiffComposerContext);
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
  const lineTarget = target.kind === "new" && isLineComposer(target) ? target : null;
  const placeholder =
    target.kind !== "new"
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
      {lineTarget ? (
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
