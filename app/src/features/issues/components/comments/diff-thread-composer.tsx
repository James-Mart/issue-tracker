import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Send } from "lucide-react";
import type { CommentInput } from "@server/schemas";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { usePostComment } from "../../api/mutations";
import { StoryComposerActions } from "./story-composer-actions";
import {
  commentInputForComposer,
  composerDraftKey,
  type OpenDiffComposer,
} from "../../lib/diff-thread-anchor";

const COMPOSER_HINT = "Enter to send, Shift+Enter for a newline";

type DiffComposerContextValue = {
  issueId: string;
  commitSha: string;
  allowQuestion: boolean;
  open: OpenDiffComposer | null;
  openNew: (anchor: Extract<OpenDiffComposer, { kind: "new" }>) => void;
  openReply: (threadId: string) => void;
  drafts: Record<string, string>;
  setDraft: (key: string, value: string) => void;
  send: (open: OpenDiffComposer, kind?: "question") => void;
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
  /** Story composers offer Ask a question beside Comment. */
  allowQuestion?: boolean;
  children: ReactNode;
}) {
  const post = usePostComment(issueId);
  const [open, setOpen] = useState<OpenDiffComposer | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const openNew = useCallback(
    (anchor: Extract<OpenDiffComposer, { kind: "new" }>) => {
      setOpen(anchor);
    },
    [],
  );
  const openReply = useCallback((threadId: string) => {
    setOpen({ kind: "reply", threadId });
  }, []);
  const setDraft = useCallback((key: string, value: string) => {
    setDrafts((prev) => ({ ...prev, [key]: value }));
  }, []);
  const send = useCallback(
    (target: OpenDiffComposer, kind?: "question") => {
      const key = composerDraftKey(target);
      const body = (drafts[key] ?? "").trim();
      if (!body || post.isPending) return;
      const input: CommentInput = commentInputForComposer(
        target,
        body,
        commitSha,
        kind,
      );
      post.mutate(input, {
        onSuccess: () => {
          setDrafts((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
          setOpen(null);
        },
      });
    },
    [allowQuestion, commitSha, drafts, post],
  );

  const value = useMemo(
    () => ({
      issueId,
      commitSha,
      allowQuestion,
      open,
      openNew,
      openReply,
      drafts,
      setDraft,
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
      drafts,
      setDraft,
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
  const { drafts, setDraft, send, pending, allowQuestion } = useDiffComposer();
  const draftKey = composerDraftKey(target);
  const draft = drafts[draftKey] ?? "";
  const askQuestion = allowQuestion && target.kind === "new";
  const heading = askQuestion
    ? "Comment or ask a question"
    : target.kind === "new"
      ? "Start a review thread"
      : "Reply";
  const placeholder =
    target.kind === "new"
      ? target.startLine !== undefined
        ? `Comment on ${lineCaption(target)}`
        : "Add a comment"
      : "Reply";

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send(target);
    }
  };

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
      {askQuestion ? null : (
        <p className="text-sm text-foreground">{heading}</p>
      )}
      <div className={askQuestion ? "flex flex-col gap-2" : "flex min-w-0 items-end gap-2"}>
        <Textarea
          value={draft}
          onChange={(event) => setDraft(draftKey, event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          title={COMPOSER_HINT}
          aria-label={heading}
          className={`min-h-[40px] min-w-0 resize-none touch:min-h-[44px]${askQuestion ? "" : " flex-1"}`}
        />
        {askQuestion ? (
          <StoryComposerActions
            pending={pending}
            canSend={draft.trim().length > 0}
            onComment={() => send(target)}
            onQuestion={() => send(target, "question")}
          />
        ) : (
          <Button
            size="icon"
            variant="primary"
            className="h-11 w-11 shrink-0"
            onClick={() => send(target)}
            disabled={pending || !draft.trim()}
            title="Send"
            aria-label="Send"
          >
            <Send className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
