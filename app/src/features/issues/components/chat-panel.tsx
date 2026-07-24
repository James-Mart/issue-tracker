import { useMemo, useState, type KeyboardEvent } from "react";
import { Send } from "lucide-react";
import type { ChatMessage } from "@server/schemas";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useChatQuery, useIssuesQuery } from "../api/queries";
import { usePostMessage } from "../api/mutations";
import { isInFlight } from "../lib/derived";
import { Markdown } from "./markdown";
import { MessageScroller } from "./chat/message-scroller";
import { Message, lastAgentMessageIndex } from "./chat/message";
import { Marker } from "./chat/marker";
import { Shimmer } from "./chat/shimmer";

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

function MessageList({
  messages,
  attachmentsIssueId,
  agentLive,
}: {
  messages: ChatMessage[];
  attachmentsIssueId?: string;
  agentLive: boolean;
}) {
  let lastDay = "";
  const liveIndex = agentLive ? lastAgentMessageIndex(messages) : -1;
  return (
    <>
      {messages.map((message, index) => {
        const key = dayKey(message.at);
        const showMarker = key !== lastDay;
        lastDay = key;
        const author = message.name ?? message.role;
        return (
          <div key={`${message.at}-${index}`} className="flex flex-col gap-2">
            {showMarker ? <Marker>{dayLabel(message.at)}</Marker> : null}
            <Message
              author={author}
              role={message.role}
              at={message.at}
              live={index === liveIndex}
            >
              <Markdown issueId={attachmentsIssueId}>{message.body}</Markdown>
            </Message>
          </div>
        );
      })}
    </>
  );
}

/** Per-issue chat thread + composer for the detail companion slot. */
export function ChatPanel({
  id,
  attachmentsIssueId,
}: {
  id: string;
  /** When set, relative Markdown links in chat resolve to this issue's attachments. */
  attachmentsIssueId?: string;
}) {
  const { data, isLoading, error } = useChatQuery(id);
  const { data: list } = useIssuesQuery();
  const post = usePostMessage(id);
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
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {error ? (
        <p className="text-sm text-destructive-foreground">{error.message}</p>
      ) : null}

      {problems.length > 0 ? (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-muted-foreground">
          {problems.map((p) => (
            <div key={p.message}>{p.message}</div>
          ))}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col">
        {isLoading ? (
          <p className="px-1 py-4 text-sm text-muted-foreground">Loading chat…</p>
        ) : messages.length === 0 ? (
          <p className="px-1 py-4 text-sm text-foreground">
            No messages yet. Type below to steer this issue.
          </p>
        ) : (
          <MessageScroller bottomKey={messages.length}>
            <MessageList
              messages={messages}
              attachmentsIssueId={attachmentsIssueId}
              agentLive={agentLive}
            />
          </MessageScroller>
        )}
      </div>

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
          placeholder="Steer this issue"
          title="Enter to send, Shift+Enter for a newline"
          aria-label="Steer this issue"
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
  );
}
