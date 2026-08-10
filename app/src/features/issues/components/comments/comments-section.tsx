import { useMemo, useState, type KeyboardEvent } from "react";
import { Send } from "lucide-react";
import type { Comment, IssueDetail } from "@server/schemas";
import { ShellFaultDetail, ShellState } from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useCommentsQuery, useIssuesQuery } from "../../api/queries";
import { usePostComment } from "../../api/mutations";
import { supportsAttachments } from "../../lib/attachments";
import { supportsComments } from "../../lib/comments";
import { isInFlight } from "../../lib/derived";
import { SettingsCard } from "../detail-section";
import { Markdown } from "../markdown";
import { Marker } from "./marker";
import { Message } from "./message";
import { Shimmer } from "./shimmer";

const COMPOSER_ROLE = "human";

function dayKey(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? at : date.toDateString();
}

function dayLabel(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function CommentList({
  messages,
  attachmentsIssueId,
}: {
  messages: Comment[];
  attachmentsIssueId?: string;
}) {
  let lastDay = "";
  return (
    <>
      {messages.map((message, index) => {
        const key = dayKey(message.at);
        const showMarker = key !== lastDay;
        lastDay = key;
        const author = message.name ?? message.role;
        return (
          <div key={`${message.at}-${index}`} className="flex flex-col">
            {showMarker ? <Marker>{dayLabel(message.at)}</Marker> : null}
            <Message author={author} role={message.role} at={message.at}>
              <Markdown issueId={attachmentsIssueId}>{message.body}</Markdown>
            </Message>
          </div>
        );
      })}
    </>
  );
}

/** Inline per-issue comments thread + composer for the detail reading column. */
export function IssueCommentsSection({ issue }: { issue: IssueDetail }) {
  if (!supportsComments(issue.kind)) return null;

  const attachmentsIssueId = supportsAttachments(issue.kind)
    ? issue.id
    : undefined;

  return (
    <div data-region="comments" id="comments" className="scroll-mt-8">
      <CommentsPanel id={issue.id} attachmentsIssueId={attachmentsIssueId} />
    </div>
  );
}

function CommentsPanel({
  id,
  attachmentsIssueId,
}: {
  id: string;
  attachmentsIssueId?: string;
}) {
  const { data, isLoading, error } = useCommentsQuery(id);
  const { data: list } = useIssuesQuery();
  const post = usePostComment(id);
  const [draft, setDraft] = useState("");

  const messages = data?.messages ?? [];
  const problems = data?.problems ?? [];

  const agentLive = useMemo(() => {
    const issue = list?.issues.find((item) => item.id === id);
    if (!issue) return false;
    return isInFlight(issue, list?.derived[id]);
  }, [id, list?.derived, list?.issues]);

  const send = () => {
    const body = draft.trim();
    if (!body || post.isPending) return;
    post.mutate({ role: COMPOSER_ROLE, body }, { onSuccess: () => setDraft("") });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <SettingsCard title="Comments">
      <div className="flex flex-col gap-3">
        {error ? (
          <ShellState
            tone="blocked"
            title="Could not load comments."
            detail={
              <ShellFaultDetail
                message={error.message}
                hint="Check the server, then reload."
              />
            }
          />
        ) : null}

        {problems.length > 0 ? (
          <div className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-muted-foreground">
            <p className="text-foreground">
              Some comment lines are unreadable and are not shown. Fix them on
              disk, then reload.
            </p>
            {problems.map((p) => (
              <div key={p.message} className="mt-1.5 font-mono">
                {p.message}
              </div>
            ))}
          </div>
        ) : null}

        {error ? null : isLoading ? (
          <p className="px-1 py-4 text-sm text-muted-foreground">
            Loading comments…
          </p>
        ) : messages.length === 0 ? (
          <ShellState
            title="No comments yet."
            detail="Add one below to leave a note on this issue."
          />
        ) : (
          <CommentList
            messages={messages}
            attachmentsIssueId={attachmentsIssueId}
          />
        )}

        {post.isPending ? (
          <Shimmer label="Sending…" />
        ) : agentLive ? (
          <Shimmer />
        ) : null}

        <div className="flex shrink-0 items-end gap-2 border-t border-border pt-3">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Add a comment"
            title="Enter to send, Shift+Enter for a newline"
            aria-label="Add a comment"
            className="min-h-[40px] resize-none"
          />
          <Button
            size="icon"
            variant="primary"
            onClick={send}
            disabled={post.isPending || !draft.trim()}
            title="Send"
            aria-label="Send"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </SettingsCard>
  );
}
