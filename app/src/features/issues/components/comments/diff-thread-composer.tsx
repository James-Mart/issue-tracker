import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { CommentInput } from "@server/schemas";
import { ReviewComposer } from "@/features/reviews/components/review-composer";
import { usePostComment } from "../../api/mutations";
import { postCommentWhenIdle } from "../../lib/post-comment-when-idle";
import {
  commentInputForComposer,
  composerDraftKey,
  type OpenDiffComposer,
} from "../../lib/diff-thread-anchor";

type DiffComposerContextValue = {
  issueId: string;
  commitSha: string;
  allowQuestion: boolean;
  open: OpenDiffComposer | null;
  openNew: (anchor: Extract<OpenDiffComposer, { kind: "new" }>) => void;
  openReply: (threadId: string) => void;
  close: () => void;
  send: (
    open: OpenDiffComposer,
    body: string,
    kind?: "question",
  ) => Promise<void>;
  pending: boolean;
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
    (anchor: Extract<OpenDiffComposer, { kind: "new" }>) => {
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
      const trimmed = body.trim();
      if (!trimmed) {
        return Promise.reject(new Error("comment was not posted"));
      }
      const input: CommentInput = commentInputForComposer(
        target,
        trimmed,
        commitSha,
        kind,
      );
      const sentKey = composerDraftKey(issueId, target);
      return postCommentWhenIdle(post, input).then(() => {
        setOpen((current) =>
          current && composerDraftKey(issueId, current) === sentKey ? null : current,
        );
      });
    },
    [commitSha, issueId, post],
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
      pending: post.isPending,
    }),
    [
      issueId,
      commitSha,
      allowQuestion,
      open,
      openNew,
      openReply,
      close,
      send,
      post.isPending,
    ],
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

function lineCaption(open: Extract<OpenDiffComposer, { kind: "new" }>): string {
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
  const { issueId, send, close, pending, allowQuestion } = useDiffComposer();
  const draftKey = composerDraftKey(issueId, target);
  const askQuestion = allowQuestion && target.kind === "new";
  const placeholder =
    target.kind === "new"
      ? target.startLine !== undefined
        ? `Comment on ${lineCaption(target)}`
        : "Add a comment"
      : "Reply";

  return (
    <div
      data-testid="diff-thread-composer"
      data-composer-kind={target.kind}
      data-draft-key={draftKey}
      className="flex flex-col gap-2 rounded-md border border-border bg-card px-3 py-2"
    >
      {target.kind === "new" ? (
        <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {lineCaption(target)}
        </p>
      ) : null}
      {target.kind === "new" && !askQuestion ? (
        <p className="text-sm text-foreground">Start a review thread</p>
      ) : null}
      <ReviewComposer
        draftKey={draftKey}
        placeholder={placeholder}
        submitLabel="Send"
        pending={pending}
        onSubmit={(body) => send(target, body)}
        onQuestion={askQuestion ? (body) => send(target, body, "question") : undefined}
        onCancel={close}
      />
    </div>
  );
}
