import {
  useEffect,
  useState,
  type KeyboardEvent,
} from "react";
import { Send, Square } from "lucide-react";
import type { TranscriptEvent } from "@server/schemas";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  useCancelConversationRun,
  useSendConversationMessage,
  useUpdateConversation,
} from "../api/mutations";
import { useAgentModelsQuery } from "../api/queries";
import { useConversationRunActive } from "../hooks/use-conversation-run-active";

export function Composer({
  conversationId,
  model: initialModel,
  events,
}: {
  conversationId: string;
  /** Conversation meta model — remembered default for the picker. */
  model: string;
  events: TranscriptEvent[];
}) {
  const { data: modelsData, isLoading: modelsLoading } = useAgentModelsQuery();
  const sendMessage = useSendConversationMessage();
  const cancelRun = useCancelConversationRun();
  const updateConversation = useUpdateConversation();
  const { runActive, markRunStarted, markRunStopped } =
    useConversationRunActive(conversationId, events);

  const [draft, setDraft] = useState("");
  const [model, setModel] = useState(initialModel);

  const models = modelsData?.models ?? [];

  useEffect(() => {
    setModel(initialModel);
  }, [conversationId, initialModel]);

  useEffect(() => {
    setDraft("");
  }, [conversationId]);

  const onModelChange = (next: string) => {
    setModel(next);
    // Always PATCH — skipping when `next === initialModel` races A→B→A while
    // the B write is in flight and leaves the server on B after invalidate.
    updateConversation.mutate({ id: conversationId, patch: { model: next } });
  };

  const send = () => {
    const prompt = draft.trim();
    if (!prompt || sendMessage.isPending || runActive) return;
    sendMessage.mutate(
      {
        id: conversationId,
        body: {
          prompt,
          ...(model.trim() ? { model: model.trim() } : {}),
        },
      },
      {
        onSuccess: () => {
          setDraft("");
          markRunStarted(events.length);
        },
      },
    );
  };

  const stop = () => {
    if (!runActive || cancelRun.isPending) return;
    cancelRun.mutate(conversationId, {
      onSuccess: () => markRunStopped(),
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const canSend =
    draft.trim().length > 0 &&
    !sendMessage.isPending &&
    !runActive &&
    model.length > 0;

  return (
    <div
      className="shrink-0 border-t border-border bg-card px-3 py-3"
      data-testid="conversation-composer"
    >
      <div className="mb-2 flex items-center gap-2">
        <Select
          value={model}
          onValueChange={onModelChange}
          disabled={modelsLoading || models.length === 0 || runActive}
        >
          <SelectTrigger
            aria-label="Model"
            className="h-8 w-auto min-w-[10rem] max-w-[16rem] font-mono text-xs"
          >
            <SelectValue
              placeholder={modelsLoading ? "Loading models…" : "Select a model"}
            />
          </SelectTrigger>
          <SelectContent>
            {models.map((entry) => (
              <SelectItem key={entry.id} value={entry.id}>
                {entry.displayName}
              </SelectItem>
            ))}
            {model && !models.some((entry) => entry.id === model) ? (
              <SelectItem value={model}>{model}</SelectItem>
            ) : null}
          </SelectContent>
        </Select>
        <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
          Agent
        </p>
      </div>

      <div className="flex items-end gap-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Message the agent"
          title="Enter to send, Shift+Enter for a newline"
          aria-label="Message the agent"
          disabled={sendMessage.isPending}
          className="min-h-[44px] max-h-40 resize-none"
        />
        {runActive ? (
          <Button
            size="icon"
            variant="destructive"
            onClick={stop}
            disabled={cancelRun.isPending}
            title="Stop"
            aria-label="Stop"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
          </Button>
        ) : (
          <Button
            size="icon"
            variant="primary"
            onClick={send}
            disabled={!canSend}
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
