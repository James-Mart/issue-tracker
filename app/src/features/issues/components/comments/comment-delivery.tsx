import type { ReactNode } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { ShellInlineFault } from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import { useResendComment } from "../../api/mutations";
import type { ThreadMessage } from "../../lib/comment-outbox";
import { Markdown } from "../markdown";
import { CommentBotIcon, commentHeaderLabels, Message } from "./message";
import { AuthorActionRow, QuoteButton } from "./quote-button";

/** A comment outside any thread, with its delivery state when it is this browser's post. */
export function DeliverableMessage({
  message,
  attachmentsIssueId,
  onQuote,
  footer,
}: {
  message: ThreadMessage;
  attachmentsIssueId?: string;
  onQuote?: () => void;
  footer?: ReactNode;
}) {
  const { author, roleBadge } = commentHeaderLabels(message.role, message.name);
  return (
    <Message
      author={author}
      roleBadge={roleBadge}
      at={message.at}
      source={message.source}
      leading={message.role === "github-bot" ? <CommentBotIcon /> : undefined}
      status={<CommentSendingMark message={message} />}
      actions={
        onQuote ? (
          <AuthorActionRow>
            <QuoteButton onClick={onQuote} />
          </AuthorActionRow>
        ) : undefined
      }
      footer={footer}
    >
      <Markdown issueId={attachmentsIssueId}>{message.body}</Markdown>
      <CommentSendFailure message={message} />
    </Message>
  );
}

/** Beside the time while this browser's post is on its way. */
export function CommentSendingMark({ message }: { message: ThreadMessage }) {
  if (message.delivery?.status !== "sending") return null;
  return (
    <span
      data-testid="comment-sending"
      role="status"
      className="inline-flex items-center gap-1 text-[hsl(var(--current))]"
    >
      <Loader2 className="h-3 w-3 shrink-0 motion-safe:animate-spin" aria-hidden />
      sending
    </span>
  );
}

/** Under the body of a post that failed: the error, and Retry with the same text. */
export function CommentSendFailure({ message }: { message: ThreadMessage }) {
  if (!message.delivery || message.delivery.status !== "failed") return null;
  return (
    <SendFailedNotice
      clientId={message.clientId}
      noun={message.kind === "question" ? "question" : "comment"}
      error={message.delivery.error}
    />
  );
}

function SendFailedNotice({
  clientId,
  noun,
  error,
}: {
  clientId: string;
  noun: "question" | "comment";
  error: string;
}) {
  const resend = useResendComment();
  return (
    <ShellInlineFault
      className="my-1"
      message={`Could not send this ${noun} — ${error}`}
      hint="Your text is kept here. Retry to send it again."
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => resend(clientId)}
          data-testid="comment-send-retry"
        >
          <RotateCcw aria-hidden />
          Retry
        </Button>
      }
    />
  );
}
