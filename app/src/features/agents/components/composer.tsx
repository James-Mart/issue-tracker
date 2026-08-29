import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { Paperclip, Send, Square, X, Zap } from "lucide-react";
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
  formatAttachmentSize,
  isImageMime,
} from "@/features/issues/lib/attachments";
import {
  useCancelConversationRun,
  useInterruptConversationRun,
  useSendConversationMessage,
  useUpdateConversation,
} from "../api/mutations";
import { useAgentModelsQuery } from "../api/queries";
import {
  conversationAttachmentApiPath,
  deleteConversationAttachment,
  uploadConversationAttachment,
  type ConversationAttachment,
} from "../api/client";
import {
  clearComposerDraft,
  readComposerDraft,
  writeComposerDraft,
} from "../lib/composer-draft-storage";

const DRAFT_PERSIST_DEBOUNCE_MS = 300;
const MAX_ATTACHMENT_MB = 25;

type UploadError = {
  name: string;
  size: number;
};

function ImageStagedChip({
  item,
  conversationId,
  onRemove,
}: {
  item: ConversationAttachment;
  conversationId: string;
  onRemove: () => void;
}) {
  return (
    <div
      className="flex shrink-0 rounded-md border border-border bg-[hsl(var(--panel-2))] py-1.5 pl-1.5 pr-1.5"
      data-staged-kind="image"
      data-testid={`staged-attachment-${item.name}`}
    >
      <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-md border border-border">
        <img
          src={conversationAttachmentApiPath(conversationId, item.name)}
          alt=""
          className="h-full w-full object-cover"
        />
        <button
          type="button"
          className="absolute right-0 top-0 inline-flex h-4 w-4 items-center justify-center rounded-sm border border-border bg-[hsl(var(--panel))] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={`Remove ${item.name}`}
          aria-label={`Remove ${item.name}`}
          onClick={onRemove}
        >
          <X className="h-2.5 w-2.5" />
        </button>
      </div>
    </div>
  );
}

function FileStagedChip({
  item,
  onRemove,
}: {
  item: ConversationAttachment;
  onRemove: () => void;
}) {
  return (
    <div
      className="flex max-w-full shrink-0 items-start gap-2 rounded-md border border-border bg-[hsl(var(--panel-2))] py-1.5 pl-2 pr-1.5"
      data-staged-kind="file"
      data-testid={`staged-attachment-${item.name}`}
    >
      <Paperclip className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p
          className="truncate font-mono text-[11px] leading-tight text-foreground sm:text-xs"
          title={item.name}
        >
          {item.name}
        </p>
        <p className="font-mono text-[10px] tabular-nums text-muted-foreground">
          {formatAttachmentSize(item.size)}
        </p>
      </div>
      <button
        type="button"
        className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title={`Remove ${item.name}`}
        aria-label={`Remove ${item.name}`}
        onClick={onRemove}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function UploadErrorBanner({ error }: { error: UploadError }) {
  return (
    <div
      className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2"
      role="alert"
      data-testid="upload-error"
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-destructive">
        File too large
      </p>
      <p className="mt-1 min-w-0 truncate font-mono text-xs text-foreground">
        {error.name}
        <span className="text-muted-foreground">
          {" "}
          · {formatAttachmentSize(error.size)}
        </span>
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Attachments must be {MAX_ATTACHMENT_MB} MB or smaller.
      </p>
    </div>
  );
}

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
  const [stagedAttachments, setStagedAttachments] = useState<
    ConversationAttachment[]
  >([]);
  const [uploadError, setUploadError] = useState<UploadError | null>(null);
  const isCoarsePointer = useIsCoarsePointer();

  const models = modelsData?.models ?? [];

  useEffect(() => {
    setModel(initialModel);
  }, [conversationId, initialModel]);

  const skipDraftPersistRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const refocusAfterSendRef = useRef(false);

  useEffect(() => {
    skipDraftPersistRef.current = true;
    setDraft(readComposerDraft(conversationId));
    setStagedAttachments([]);
    setUploadError(null);
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
    setStagedAttachments([]);
    setUploadError(null);
    refocusAfterSendRef.current = true;
  };

  const onModelChange = (next: string) => {
    setModel(next);
    // Always PATCH — skipping when `next === initialModel` races A→B→A while
    // the B write is in flight and leaves the server on B after invalidate.
    updateConversation.mutate({ id: conversationId, patch: { model: next } });
  };

  const messageBody = () => {
    const prompt = draft.trim();
    const attachmentNames = stagedAttachments.map((item) => item.name);
    return {
      prompt,
      ...(model.trim() ? { model: model.trim() } : {}),
      ...(attachmentNames.length > 0 ? { attachments: attachmentNames } : {}),
    };
  };

  const canSubmit =
    (draft.trim().length > 0 || stagedAttachments.length > 0) && !composerBusy;

  const send = () => {
    if (!canSubmit) return;
    sendMessage.mutate(
      { id: conversationId, body: messageBody() },
      { onSuccess: onSuccessfulSend },
    );
  };

  const sendNow = () => {
    if (!canSubmit) return;
    interruptRun.mutate(
      { id: conversationId, body: messageBody() },
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

  const onAttachClick = () => {
    fileInputRef.current?.click();
  };

  const onFileInputChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    e.target.value = "";
    if (!files?.length) return;

    for (const file of Array.from(files)) {
      try {
        setUploadError(null);
        const meta = await uploadConversationAttachment(conversationId, file);
        setStagedAttachments((prev) => [...prev, meta]);
      } catch {
        setUploadError({ name: file.name, size: file.size });
      }
    }
  };

  const removeStagedAttachment = async (name: string) => {
    await deleteConversationAttachment(conversationId, name);
    setStagedAttachments((prev) => prev.filter((item) => item.name !== name));
  };

  const sendLabel = runActive ? "Queue message" : "Send";
  const sendTitle = runActive
    ? "Queue message — sends after the current run finishes"
    : "Send";

  return (
    <div
      className="shrink-0 border-t border-border bg-card px-3 py-3"
      data-testid="conversation-composer"
    >
      <div className="flex flex-col gap-2">
        {uploadError ? <UploadErrorBanner error={uploadError} /> : null}

        {stagedAttachments.length > 0 ? (
          <div
            className="flex flex-wrap gap-2"
            aria-label="Staged attachments"
            data-testid="staged-attachments"
          >
            {stagedAttachments.map((item) =>
              isImageMime(item.mimeType) ? (
                <ImageStagedChip
                  key={item.name}
                  item={item}
                  conversationId={conversationId}
                  onRemove={() => void removeStagedAttachment(item.name)}
                />
              ) : (
                <FileStagedChip
                  key={item.name}
                  item={item}
                  onRemove={() => void removeStagedAttachment(item.name)}
                />
              ),
            )}
          </div>
        ) : null}

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
            <input
              ref={fileInputRef}
              type="file"
              className="sr-only"
              aria-hidden="true"
              tabIndex={-1}
              onChange={(e) => void onFileInputChange(e)}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-11 w-11 shrink-0 bg-[hsl(var(--panel))] hover:border-[hsl(var(--rail-lit))] shell:h-9 shell:w-9"
              title="Attach files"
              aria-label="Attach files"
              disabled={composerBusy}
              onClick={onAttachClick}
            >
              <Paperclip className="h-4 w-4" />
            </Button>
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
                  disabled={!canSubmit}
                  title={sendTitle}
                  aria-label={sendLabel}
                >
                  <Send className="h-4 w-4" />
                </Button>
                {draft.trim().length > 0 || stagedAttachments.length > 0 ? (
                  <Button
                    size="icon"
                    variant="secondary"
                    className="h-11 w-11 shrink-0"
                    onClick={sendNow}
                    disabled={!canSubmit}
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
                disabled={!canSubmit}
                title={sendTitle}
                aria-label={sendLabel}
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
