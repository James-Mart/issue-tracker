import { useState } from "react";
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

/** Body of one comment, or the shared composer while that comment is being edited. */
export function EditableCommentBody({
  comment,
  issueId,
  onEdit,
}: {
  comment: ThreadMessage;
  issueId?: string;
  onEdit?: (commentId: string, body: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const { pending, error } = useCommentEditStore(
    useShallow((state) => ({
      pending: state.pending[comment.id] === true,
      error: state.errors[comment.id],
    })),
  );
  const canEdit = comment.editable === true && onEdit != null && issueId != null;

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
          onSubmit={(body) => {
            setEditing(false);
            return onEdit(comment.id, body);
          }}
          onCancel={() => {
            clearReviewDraft(draftKey);
            setEditing(false);
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
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-1 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="comment-edit"
            disabled={pending}
            onClick={() => {
              seedReviewDraftIfAbsent(
                editDraftKey(issueId, comment.id),
                comment.body,
              );
              setEditing(true);
            }}
          >
            <Pencil aria-hidden />
            Edit
          </Button>
        </div>
      ) : null}
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
