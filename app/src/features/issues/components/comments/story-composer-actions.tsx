import { Button } from "@/components/ui/button";

/** Comment and Ask a question, side by side, for a new Story thread. */
export function StoryComposerActions({
  pending,
  canSend,
  onComment,
  onQuestion,
}: {
  pending: boolean;
  canSend: boolean;
  onComment: () => void;
  onQuestion: () => void;
}) {
  const disabled = pending || !canSend;
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
      <Button
        type="button"
        size="sm"
        variant="primary"
        onClick={onComment}
        disabled={disabled}
        aria-label="Comment"
      >
        Comment
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onQuestion}
        disabled={disabled}
        aria-label="Ask a question"
      >
        Ask a question
      </Button>
    </div>
  );
}
