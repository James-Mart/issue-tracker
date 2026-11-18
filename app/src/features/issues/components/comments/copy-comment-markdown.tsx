import { CopyTextButton } from "../copy-text-button";

/** `body` is the comment's stored Markdown, not the rendered HTML. */
export function CopyCommentMarkdown({ body }: { body: string }) {
  return (
    <CopyTextButton
      text={body}
      label="Copy Markdown"
      testId="comment-copy-markdown"
      className="self-start text-muted-foreground"
    />
  );
}
