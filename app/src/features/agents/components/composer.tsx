import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Send, Square, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useIsCoarsePointer } from "@/hooks/use-coarse-pointer";
import {
  useCancelConversationRun,
  useInterruptConversationRun,
  useSendConversationMessage,
  useUpdateConversation,
} from "../api/mutations";
import { useAgentModelsQuery } from "../api/queries";
import {
  clearComposerDraft,
  readComposerDraft,
  writeComposerDraft,
} from "../lib/composer-draft-storage";

const DRAFT_PERSIST_DEBOUNCE_MS = 300;

export function Composer({
  conversationId,
  model: initialModel,
  runActive,
}: {
  conversationId: string;
  /** Conversation meta model — remembered default for the picker. */
  model: string;
  /** Server-truth run-active flag from the open thread. */
  runActive: boolean;
}) {
  const { data: modelsData, isLoading: modelsLoading } = useAgentModelsQuery();
  const sendMessage = useSendConversationMessage();
  const interruptRun = useInterruptConversationRun();
  const cancelRun = useCancelConversationRun();
  const updateConversation = useUpdateConversation();

  const [draft, setDraft] = useState("");
  const [model, setModel] = useState(initialModel);
  const isCoarsePointer = useIsCoarsePointer();

  const models = modelsData?.models ?? [];

  useEffect(() => {
    setModel(initialModel);
  }, [conversationId, initialModel]);

  const skipDraftPersistRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const refocusAfterSendRef = useRef(false);

  useEffect(() => {
    skipDraftPersistRef.current = true;
    setDraft(readComposerDraft(conversationId));
  }, [conversationId]);

  useEffect(() => {
    if (skipDraftPersistRef.current) {
      skipDraftPersistRef.current = false;
      return;
    }
    const handle = window.setTimeout(() => {
      writeComposerDraft(conversationId, draft);
    }, DRAFT_PERSIST_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [conversationId, draft]);

  const composerBusy = sendMessage.isPending || interruptRun.isPending;

  useEffect(() => {
    if (!refocusAfterSendRef.current || composerBusy) return;
    refocusAfterSendRef.current = false;
    textareaRef.current?.focus();
  }, [composerBusy, draft]);

  const onSuccessfulSend = () => {
    clearComposerDraft(conversationId);
    setDraft("");
    refocusAfterSendRef.current = true;
  };

  const onModelChange = (next: string) => {
    setModel(next);
    // Always PATCH — skipping when `next === initialModel` races A→B→A while
    // the B write is in flight and leaves the server on B after invalidate.
    updateConversation.mutate({ id: conversationId, patch: { model: next } });
  };

  const send = () => {
    const prompt = draft.trim();
    if (!prompt || composerBusy) return;
    sendMessage.mutate(
      {
        id: conversationId,
        body: {
          prompt,
          ...(model.trim() ? { model: model.trim() } : {}),
        },
      },
      { onSuccess: onSuccessfulSend },
    );
  };

  const sendNow = () => {
    const prompt = draft.trim();
    if (!prompt || composerBusy) return;
    interruptRun.mutate(
      {
        id: conversationId,
        body: {
          prompt,
          ...(model.trim() ? { model: model.trim() } : {}),
        },
      },
      { onSuccess: onSuccessfulSend },
    );
  };

  const stop = () => {
    if (!runActive || cancelRun.isPending) return;
    cancelRun.mutate(conversationId);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !isCoarsePointer) {
      e.preventDefault();
      send();
    }
  };

  const canSend = draft.trim().length > 0 && !composerBusy;
  const canSendNow = draft.trim().length > 0 && !composerBusy;

  const sendLabel = runActive ? "Queue message" : "Send";
  const sendTitle = runActive
    ? "Queue message — sends after the current run finishes"
    : "Send";

  return (
    <div
      className="shrink-0 border-t border-border bg-card px-3 py-3"
      data-testid="conversation-composer"
    >
      <div className="flex flex-col gap-2 shell:flex-row shell:items-end">
        <div className="flex w-full min-w-0 items-center gap-2 shell:w-auto shell:shrink-0">
          <Select
            value={model}
            onValueChange={onModelChange}
            disabled={modelsLoading || models.length === 0 || runActive}
          >
            <SelectTrigger
              aria-label="Model"
              className="h-11 w-full min-w-0 font-mono text-xs shell:h-8 shell:w-auto shell:min-w-[10rem] shell:max-w-[16rem]"
            >
              <SelectValue
                placeholder={
                  modelsLoading ? "Loading models…" : "Select a model"
                }
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
          <p className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
            Agent
          </p>
        </div>

        <div className="flex min-w-0 flex-1 flex-wrap items-end gap-2">
          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Message the agent"
            title={
              isCoarsePointer
                ? "Enter for a new line"
                : "Enter to send, Shift+Enter for a newline"
            }
            aria-label="Message the agent"
            disabled={composerBusy}
            className="min-h-[44px] min-w-0 max-h-40 w-full flex-1 basis-[12rem] resize-none shell:w-auto"
          />
          {runActive ? (
            <>
              <Button
                size="icon"
                variant="primary"
                className="h-11 w-11 shrink-0"
                onClick={send}
                disabled={!canSend}
                title={sendTitle}
                aria-label={sendLabel}
              >
                <Send className="h-4 w-4" />
              </Button>
              {draft.trim().length > 0 ? (
                <Button
                  size="icon"
                  variant="secondary"
                  className="h-11 w-11 shrink-0"
                  onClick={sendNow}
                  disabled={!canSendNow}
                  title="Send now — interrupt the current run and send immediately"
                  aria-label="Send now"
                >
                  <Zap className="h-4 w-4" />
                </Button>
              ) : null}
              <Button
                size="icon"
                variant="destructive"
                className="h-11 w-11 shrink-0"
                onClick={stop}
                disabled={cancelRun.isPending}
                title="Stop"
                aria-label="Stop"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </Button>
            </>
          ) : (
            <Button
              size="icon"
              variant="primary"
              className="h-11 w-11 shrink-0"
              onClick={send}
              disabled={!canSend}
              title={sendTitle}
              aria-label={sendLabel}
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
