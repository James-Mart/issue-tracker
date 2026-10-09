import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { ShellInlineFault } from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import { ReviewComposer } from "@/features/reviews/components/review-composer";
import { editDraftKey } from "@/features/reviews/lib/review-draft-key";
import {
  clearReviewDraft,
  seedReviewDraftIfAbsent,
} from "@/features/reviews/lib/review-draft-storage";
import type { ThreadMessage } from "../../lib/comment-outbox";
import { useCommentEditStore } from "../../store/use-comment-edit-store";
import { Markdown } from "../markdown";
import { CommentSendFailure } from "./comment-delivery";
import { AUTHOR_ACTION_CLASS } from "./quote-button";

type CommentEditContextValue = {
  editing: boolean;
  canEdit: boolean;
  pending: boolean;
  start: () => void;
  stop: () => void;
  comment: ThreadMessage;
  issueId?: string;
  onEdit?: (commentId: string, body: string) => Promise<void>;
  error?: string;
};

const CommentEditContext = createContext<CommentEditContextValue | null>(null);

function useCommentEditContext(): CommentEditContextValue | null {
  return useContext(CommentEditContext);
}

export function useCommentEditOffer(): boolean {
  const edit = useCommentEditContext();
  return edit?.canEdit === true && !edit.editing;
}

/** Edit state for one comment. The action sits on the author line; the body swaps below it. */
export function CommentEditScope({
  comment,
  issueId,
  onEdit,
  children,
}: {
  comment: ThreadMessage;
  issueId?: string;
  onEdit?: (commentId: string, body: string) => Promise<void>;
  children: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const { pending, error } = useCommentEditStore(
    useShallow((state) => ({
      pending: state.pending[comment.id] === true,
      error: state.errors[comment.id],
    })),
  );
  const canEdit = comment.editable === true && onEdit != null && issueId != null;
  const start = useCallback(() => {
    if (issueId == null) {
      throw new Error("Edit requires an issue id");
    }
    seedReviewDraftIfAbsent(editDraftKey(issueId, comment.id), comment.body);
    setEditing(true);
  }, [comment.body, comment.id, issueId]);
  const stop = useCallback(() => setEditing(false), []);
  const value = useMemo(
    () => ({
      editing,
      canEdit,
      pending,
      start,
      stop,
      comment,
      issueId,
      onEdit,
      error,
    }),
    [editing, canEdit, pending, start, stop, comment, issueId, onEdit, error],
  );

  return (
    <CommentEditContext.Provider value={value}>{children}</CommentEditContext.Provider>
  );
}

export function CommentEditAction() {
  const edit = useCommentEditContext();
  if (!edit?.canEdit || edit.editing) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={AUTHOR_ACTION_CLASS}
      data-testid="comment-edit"
      disabled={edit.pending}
      onClick={edit.start}
    >
      <Pencil aria-hidden />
      Edit
    </Button>
  );
}

export function CommentEditBody() {
  const edit = useCommentEditContext();
  if (!edit) return null;
  const { editing, comment, issueId, onEdit, error, stop } = edit;
  if (editing && onEdit && issueId) {
    const draftKey = editDraftKey(issueId, comment.id);
    return (
      <div data-testid="pending-comment-edit" className="mt-1">
        <ReviewComposer
          draftKey={draftKey}
          baseline={comment.body}
          placeholder="Edit comment"
          submitLabel="Save"
          fieldHint="Enter to save, Shift+Enter for a newline"
          autoFocus
          onSubmit={(next) => {
            stop();
            return onEdit(comment.id, next);
          }}
          onCancel={() => {
            clearReviewDraft(draftKey);
            stop();
          }}
        />
      </div>
    );
  }
  return (
    <>
      <Markdown issueId={issueId}>{comment.body}</Markdown>
      <CommentSendFailure message={comment} />
      {error ? <CommentEditFailure error={error} /> : null}
    </>
  );
}

function CommentEditFailure({ error }: { error: string }) {
  return (
    <div data-testid="comment-edit-error" className="my-1">
      <ShellInlineFault
        message={`Could not save this edit — ${error}`}
        hint="The comment is unchanged."
      />
    </div>
  );
}
