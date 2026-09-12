import { useEffect, useRef, useState } from "react";
import { Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useClearConversationPending,
  useSendConversationMessage,
  useUpdateConversationPending,
} from "../api/mutations";

export function PendingMessageRow({
  conversationId,
  text,
  runActive,
  model,
}: {
  conversationId: string;
  text: string;
  runActive: boolean;
  model: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const inputRef = useRef<HTMLInputElement>(null);
  const updatePending = useUpdateConversationPending();
  const clearPending = useClearConversationPending();
  const sendMessage = useSendConversationMessage();

  useEffect(() => {
    if (!editing) setDraft(text);
  }, [text, editing]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commitEdit = () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === text) {
      setEditing(false);
      return;
    }
    updatePending.mutate(
      { id: conversationId, text: trimmed },
      { onSettled: () => setEditing(false) },
    );
  };

  const sendNow = () => {
    if (sendMessage.isPending) return;
    sendMessage.mutate({
      id: conversationId,
      body: {
        prompt: text,
        ...(model.trim() ? { model: model.trim() } : {}),
      },
    });
  };

  return (
    <div
      className="mt-3 flex min-w-0 flex-col gap-2 rounded-lg border border-dashed border-border/70 bg-muted/30 px-3.5 py-2.5 opacity-70"
      data-testid="pending-message-row"
      data-run-active={runActive ? "true" : "false"}
    >
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {runActive ? "Queued" : "Not sent"}
          </p>
          {editing ? (
            <form
              className="min-w-0"
              onSubmit={(event) => {
                event.preventDefault();
                commitEdit();
              }}
            >
              <Input
                ref={inputRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={commitEdit}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setEditing(false);
                }}
                className="h-8 text-sm"
                disabled={updatePending.isPending}
                aria-label="Edit queued message"
              />
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="block w-full min-w-0 rounded-md text-left text-sm text-foreground hover:bg-accent/40"
            >
              <span className="whitespace-pre-wrap break-words">{text}</span>
            </button>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground"
          onClick={() => clearPending.mutate(conversationId)}
          disabled={clearPending.isPending}
          title="Remove queued message"
          aria-label="Remove queued message"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      {!runActive ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="min-w-0 text-xs text-muted-foreground">
            The run ended before this message could send.
          </p>
          <Button
            size="sm"
            variant="secondary"
            className="h-7 gap-1 px-2"
            onClick={sendNow}
            disabled={sendMessage.isPending}
            data-testid="pending-send-now"
          >
            <Send className="h-3.5 w-3.5" />
            Send now
          </Button>
        </div>
      ) : null}
    </div>
  );
}
