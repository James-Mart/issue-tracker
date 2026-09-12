import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Download, Link2, Paperclip } from "lucide-react";
import type { TranscriptEvent } from "@server/schemas";
import { ShellFaultDetail, ShellState } from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { currentGlow, liveChip } from "@/components/ui/overlay-surfaces";
import { Skeleton } from "@/components/ui/skeleton";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { cn } from "@/lib/utils/cn";
import {
  formatAttachmentSize,
  isImageMime,
} from "@/features/issues/lib/attachments";
import { useConversationsQuery, useConversationAttachmentsQuery } from "../api/queries";
import {
  conversationAttachmentApiPath,
  type ConversationAttachment,
} from "../api/client";
import { useForkConversation } from "../api/mutations";
import { useConversationEvents } from "../hooks/use-conversation-events";
import { useConversationRunActive } from "../hooks/use-conversation-run-active";
import { useAgentsUiStore } from "../store/use-agents-ui-store";
import {
  deriveSubAgents,
  isSubAgentToolCall,
  type SubAgent,
} from "../lib/subagent";
import {
  deriveTurns,
  groupOrdinaryToolCalls,
  transcriptInfoLine,
} from "../lib/transcript-rows";
import {
  formatUsageTotals,
  sumUsageTotals,
  threadRunLabel,
} from "../lib/thread-status";
import { MessageScroller } from "@/components/ui/message-scroller";
import { transcriptScrollerBottomKey } from "../lib/transcript-scroller";
import { AssistantMetaRow } from "./assistant-meta-row";
import { Composer } from "./composer";
import { ForkedThreadComposerNotice } from "./forked-thread-composer-notice";
import {
  ForkPointInlineMarker,
  forkPointMarkerDueAfterSegment,
  forkPointMarkerDueBeforeSegment,
  segmentEventIndices,
} from "./fork-point-inline-marker";
import { ForkedThreadReadOnlyBadge } from "./forked-thread-read-only-badge";
import { PendingMessageRow } from "./pending-message-row";
import { SubagentCard } from "./subagent-card";
import {
  indexedStreamKey,
  toolCallRowKey,
  ToolUseGroup,
  TranscriptMarkdownText,
  TranscriptThinking,
  TranscriptToolCall,
} from "./transcript-ui";

function eventKey(event: TranscriptEvent, index: number): string {
  if (event.type === "tool_call") return toolCallRowKey(event.callId);
  // Index-stable for in-place assistant/thinking delta updates (avoid
  // remounting Markdown / details on every token). `at` changes each delta
  // and is not usable. Thinking coalesces in applyTranscriptEvent across
  // invisible noise so one stream chain maps to one index.
  return indexedStreamKey(index, event.type);
}

function InfoLine({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-1 py-1 font-mono text-[11px] text-muted-foreground">
      <span className="uppercase tracking-[0.08em] text-[hsl(var(--mut))]">
        {label}
      </span>
      <span className="min-w-0 text-foreground/80">{children}</span>
    </div>
  );
}

function ErrorEvent({ message }: { message: string }) {
  return (
    <div
      className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground"
      data-event="error"
    >
      <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-destructive">
        Send failed
      </p>
      <p className="whitespace-pre-wrap break-words font-mono text-xs">
        {message}
      </p>
      <p className="mt-2 text-muted-foreground">
        The turn did not reach the agent. Send it again, or check the server.
      </p>
    </div>
  );
}

function PromptAttachmentImage({
  conversationId,
  name,
}: {
  conversationId: string;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const src = conversationAttachmentApiPath(conversationId, name);

  return (
    <>
      <button
        type="button"
        data-prompt-attachment-image={name}
        className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setOpen(true)}
        title={name}
        aria-label={name}
      >
        <img src={src} alt="" className="h-full w-full object-cover" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-auto max-w-[min(96vw,80rem)] p-3">
          <DialogTitle className="sr-only">{name}</DialogTitle>
          <img
            src={src}
            alt=""
            className="max-h-[85vh] w-auto max-w-full rounded-md"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function PromptAttachmentFileRow({
  conversationId,
  item,
}: {
  conversationId: string;
  item: ConversationAttachment;
}) {
  const href = conversationAttachmentApiPath(conversationId, item.name);
  return (
    <div
      className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-[hsl(var(--panel))] px-2 py-1.5"
      data-prompt-attachment-file={item.name}
    >
      <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
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
      <a
        href={href}
        download={item.name}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title={`Download ${item.name}`}
        aria-label={`Download ${item.name}`}
      >
        <Download className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}

function PromptAttachmentMissingRow({ name }: { name: string }) {
  return (
    <div
      className="min-w-0 rounded-md border border-border bg-[hsl(var(--panel))] px-2 py-1.5"
      data-prompt-attachment-missing={name}
    >
      <p
        className="truncate font-mono text-[11px] leading-tight text-muted-foreground sm:text-xs"
        title={name}
      >
        {name}
      </p>
    </div>
  );
}

function PromptEventAttachments({
  conversationId,
  names,
  attachmentByName,
  attachmentsLoading,
}: {
  conversationId: string;
  names: string[];
  attachmentByName: Map<string, ConversationAttachment>;
  attachmentsLoading: boolean;
}) {
  if (names.length === 0) return null;

  if (attachmentsLoading) {
    return (
      <div
        className="mt-2 flex min-w-0 flex-col gap-2"
        data-testid="prompt-attachments-loading"
        aria-busy="true"
        aria-label="Loading attachments"
      >
        {names.map((name) => (
          <Skeleton key={name} className="h-10 w-full max-w-xs rounded-md" />
        ))}
      </div>
    );
  }

  const segments: ReactNode[] = [];
  let imageBatch: string[] = [];

  const flushImages = () => {
    if (imageBatch.length === 0) return;
    segments.push(
      <div
        key={`images-${imageBatch[0]}`}
        className="flex flex-wrap gap-2"
        data-testid="prompt-attachment-images"
      >
        {imageBatch.map((name) => (
          <PromptAttachmentImage
            key={name}
            conversationId={conversationId}
            name={name}
          />
        ))}
      </div>,
    );
    imageBatch = [];
  };

  for (const name of names) {
    const meta = attachmentByName.get(name);
    if (meta && isImageMime(meta.mimeType)) {
      imageBatch.push(name);
      continue;
    }
    flushImages();
    if (meta) {
      segments.push(
        <PromptAttachmentFileRow
          key={name}
          conversationId={conversationId}
          item={meta}
        />,
      );
    } else {
      segments.push(<PromptAttachmentMissingRow key={name} name={name} />);
    }
  }
  flushImages();

  return <div className="mt-2 flex min-w-0 flex-col gap-2">{segments}</div>;
}

function PromptEvent({
  text,
  attachments,
  conversationId,
  attachmentByName,
  attachmentsLoading,
}: {
  text: string;
  attachments?: string[];
  conversationId: string;
  attachmentByName: Map<string, ConversationAttachment>;
  attachmentsLoading: boolean;
}) {
  const names = attachments ?? [];
  return (
    <div className="flex min-w-0 justify-end" data-event="prompt">
      <div className="min-w-0 max-w-[min(85%,100%)] rounded-lg border border-border bg-[hsl(var(--panel-2))] px-3.5 py-2.5">
        <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          You
        </p>
        {text ? (
          <p className="whitespace-pre-wrap break-words text-sm text-foreground">
            {text}
          </p>
        ) : null}
        <PromptEventAttachments
          conversationId={conversationId}
          names={names}
          attachmentByName={attachmentByName}
          attachmentsLoading={attachmentsLoading}
        />
      </div>
    </div>
  );
}

function AssistantEvent({ text }: { text: string }) {
  return (
    <div className="min-w-0" data-event="assistant">
      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[hsl(var(--current))]">
        Assistant
      </p>
      <TranscriptMarkdownText text={text} />
    </div>
  );
}

function ThinkingEvent({ text, open }: { text: string; open?: boolean }) {
  return (
    <TranscriptThinking text={text} open={open} data-event="thinking" />
  );
}

function ToolCallEvent({
  event,
}: {
  event: Extract<TranscriptEvent, { type: "tool_call" }>;
}) {
  return (
    <TranscriptToolCall
      callId={event.callId}
      name={event.name}
      status={event.status}
      args={event.args}
      result={event.result}
      data-event="tool_call"
    />
  );
}

/** True when no later event has superseded this thinking block in the stream. */
function isLiveThinking(events: TranscriptEvent[], index: number): boolean {
  for (let i = index + 1; i < events.length; i++) {
    const t = events[i]?.type;
    if (t === "thinking" || t === "assistant" || t === "tool_call") {
      return false;
    }
  }
  return true;
}

function TranscriptEventRow({
  event,
  subAgentsByCallId,
  thinkingOpen,
  conversationId,
  attachmentByName,
  attachmentsLoading,
}: {
  event: TranscriptEvent;
  subAgentsByCallId: Map<string, SubAgent>;
  thinkingOpen?: boolean;
  conversationId: string;
  attachmentByName: Map<string, ConversationAttachment>;
  attachmentsLoading: boolean;
}) {
  switch (event.type) {
    case "prompt":
      return (
        <PromptEvent
          text={event.text}
          attachments={event.attachments}
          conversationId={conversationId}
          attachmentByName={attachmentByName}
          attachmentsLoading={attachmentsLoading}
        />
      );
    case "assistant":
      return <AssistantEvent text={event.text} />;
    case "thinking":
      return <ThinkingEvent text={event.text} open={thinkingOpen} />;
    case "tool_call": {
      if (isSubAgentToolCall(event)) {
        const agent = subAgentsByCallId.get(event.callId);
        if (agent) return <SubagentCard agent={agent} />;
      }
      return <ToolCallEvent event={event} />;
    }
    case "task":
    case "status":
    case "usage":
    case "request":
    case "delegation_recovery": {
      const info = transcriptInfoLine(event);
      if (!info) return null;
      return <InfoLine label={info.label}>{info.text}</InfoLine>;
    }
    case "error":
      return <ErrorEvent message={event.message} />;
    case "subagent_update":
      // Folded into SubagentCard via deriveSubAgents; not a top-level row.
      return null;
    default:
      // Tolerate unknown future kinds without crashing.
      return null;
  }
}

function TranscriptHistoryFailed({
  errorMessage,
  isRetrying,
  onRetry,
}: {
  errorMessage?: string;
  isRetrying: boolean;
  onRetry: () => void;
}) {
  return (
    <ShellState
      className="m-4 border-0 bg-transparent px-4 py-8 shadow-none"
      tone="blocked"
      eyebrow="Fault"
      title="Could not load the transcript."
      detail={
        <ShellFaultDetail
          message={
            errorMessage ?? "The transcript request failed or timed out."
          }
          hint="Check the server, then try again."
        />
      }
      action={
        <Button
          variant="primary"
          disabled={isRetrying}
          onClick={onRetry}
          data-testid="transcript-retry"
        >
          Retry
        </Button>
      }
    />
  );
}

function ThreadBody({
  events,
  ready,
  historyFailed,
  historyErrorMessage,
  isRefetchingHistory,
  onRetryHistory,
  pendingMessageText,
  runActive,
  conversationId,
  model,
  keyboardInset,
  forkedAtSeq,
}: {
  events: TranscriptEvent[];
  ready: boolean;
  historyFailed: boolean;
  historyErrorMessage?: string;
  isRefetchingHistory: boolean;
  onRetryHistory: () => void;
  pendingMessageText: string | null;
  runActive: boolean;
  conversationId: string;
  model: string;
  keyboardInset: number;
  forkedAtSeq?: number;
}) {
  const { data: storeAttachments, isLoading: attachmentsLoading } =
    useConversationAttachmentsQuery(conversationId);
  const attachmentByName = useMemo(
    () => new Map((storeAttachments ?? []).map((item) => [item.name, item])),
    [storeAttachments],
  );
  const forkConversation = useForkConversation();
  const setSelectedConversationId = useAgentsUiStore(
    (s) => s.setSelectedConversationId,
  );
  const forkCuts = useMemo(() => {
    const cuts = new Map<number, number>();
    for (const turn of deriveTurns(events)) {
      if (turn.lastAssistantSeq === undefined) continue;
      if (turn.isLastTurn && runActive) continue;
      cuts.set(turn.lastAssistantSeq, turn.lastEventSeq);
    }
    return cuts;
  }, [events, runActive]);

  if (historyFailed) {
    return (
      <TranscriptHistoryFailed
        errorMessage={historyErrorMessage}
        isRetrying={isRefetchingHistory}
        onRetry={onRetryHistory}
      />
    );
  }

  if (!ready) {
    return (
      <div
        className="space-y-3 p-4"
        aria-busy="true"
        aria-label="Loading transcript"
      >
        <Skeleton className="ml-auto h-16 w-2/3" />
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-8 w-2/5" />
      </div>
    );
  }

  if (events.length === 0 && !pendingMessageText) {
    return (
      <ShellState
        className="m-4 border-0 bg-transparent px-4 py-8 shadow-none"
        eyebrow="Empty"
        title="No transcript yet."
        detail="Type below to start a turn — responses stream here live."
      />
    );
  }

  const subAgentsByCallId = new Map(
    deriveSubAgents(events).map((agent) => [agent.callId, agent]),
  );
  const segments = groupOrdinaryToolCalls(events);
  const forkAtEventIndex =
    forkedAtSeq !== undefined
      ? events.findIndex((event) => event.seq === forkedAtSeq)
      : -1;
  let forkMarkerInserted = false;
  let maxRenderedEventIndex = -1;
  const transcriptRows: ReactNode[] = [];

  for (const segment of segments) {
    const segmentIndices = segmentEventIndices(events, segment);
    const segmentMinIndex = Math.min(...segmentIndices);
    const segmentMaxIndex = Math.max(...segmentIndices);

    if (
      forkPointMarkerDueBeforeSegment(
        forkAtEventIndex,
        segmentMinIndex,
        forkMarkerInserted,
      )
    ) {
      transcriptRows.push(<ForkPointInlineMarker key="fork-point-marker" />);
      forkMarkerInserted = true;
    }

    if (segment.kind === "tool_use_group") {
      transcriptRows.push(
        <ToolUseGroup
          key={`tool_use_group-${segment.events[0]!.callId}`}
          tools={segment.events}
        />,
      );
    } else {
      const index = events.indexOf(segment.event);
      const forkSeq =
        segment.event.type === "assistant" &&
        segment.event.seq !== undefined
          ? forkCuts.get(segment.event.seq)
          : undefined;
      transcriptRows.push(
        <div key={eventKey(segment.event, index)} className="min-w-0">
          <TranscriptEventRow
            event={segment.event}
            subAgentsByCallId={subAgentsByCallId}
            thinkingOpen={
              segment.event.type === "thinking" &&
              isLiveThinking(events, index)
            }
            conversationId={conversationId}
            attachmentByName={attachmentByName}
            attachmentsLoading={attachmentsLoading}
          />
          {forkSeq !== undefined ? (
            <AssistantMetaRow
              at={segment.event.at}
              onFork={() =>
                forkConversation.mutate(
                  { id: conversationId, seq: forkSeq },
                  {
                    onSuccess: (created) =>
                      setSelectedConversationId(created.id),
                  },
                )
              }
            />
          ) : null}
        </div>,
      );
    }

    maxRenderedEventIndex = Math.max(maxRenderedEventIndex, segmentMaxIndex);
    if (
      forkPointMarkerDueAfterSegment(
        forkAtEventIndex,
        maxRenderedEventIndex,
        forkMarkerInserted,
      )
    ) {
      transcriptRows.push(<ForkPointInlineMarker key="fork-point-marker" />);
      forkMarkerInserted = true;
    }
  }

  return (
    <MessageScroller
      bottomKey={transcriptScrollerBottomKey(
        events,
        pendingMessageText,
        keyboardInset,
      )}
      className="min-w-0 overflow-x-hidden px-4 py-4"
      role="log"
      aria-label="Conversation transcript"
      aria-live="polite"
      aria-relevant="additions text"
    >
      {transcriptRows}
      {pendingMessageText ? (
        <PendingMessageRow
          conversationId={conversationId}
          text={pendingMessageText}
          runActive={runActive}
          model={model}
        />
      ) : null}
    </MessageScroller>
  );
}

function ThreadStatusStrip({
  runActive,
  events,
  readOnly,
}: {
  runActive: boolean;
  events: readonly TranscriptEvent[];
  readOnly?: boolean;
}) {
  const label = threadRunLabel(runActive);
  const totals = sumUsageTotals(events);
  const usageText = formatUsageTotals(totals);

  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1"
      data-testid="thread-status-strip"
    >
      <span
        className={liveChip}
        data-run-active={runActive ? "true" : "false"}
        aria-live="polite"
      >
        <span
          aria-hidden
          className={cn(
            "h-[7px] w-[7px] shrink-0 rounded-full",
            runActive
              ? cn(
                  "bg-[hsl(var(--current))] motion-safe:animate-live-dot",
                  currentGlow,
                )
              : "bg-[hsl(var(--rail-lit))]",
          )}
        />
        {label}
      </span>
      {readOnly ? <ForkedThreadReadOnlyBadge /> : null}
      <span className="min-w-0 font-mono text-[11px] tabular-nums text-muted-foreground">
        {usageText}
      </span>
    </div>
  );
}

function ForkedThreadSourceLink({
  sourceConversationId,
  onSelect,
}: {
  sourceConversationId: string;
  onSelect: (conversationId: string) => void;
}) {
  return (
    <button
      type="button"
      className="inline-flex min-w-0 items-center gap-1 font-mono text-[11px] text-[hsl(var(--current))] hover:underline hover:underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="forked-thread-source-link"
      onClick={() => onSelect(sourceConversationId)}
    >
      <Link2 className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">Source conversation</span>
    </button>
  );
}

/** Open-thread density: Back, title, optional trailing actions, status strip. */
export function OpenThreadChrome({
  title,
  onBack,
  backAriaLabel = "Back to conversations",
  runActive,
  events,
  actions,
  readOnly,
  forkedFrom,
  onSourceConversation,
}: {
  title: string;
  onBack?: () => void;
  backAriaLabel?: string;
  runActive: boolean;
  events: readonly TranscriptEvent[];
  actions?: ReactNode;
  readOnly?: boolean;
  forkedFrom?: string;
  onSourceConversation?: (conversationId: string) => void;
}) {
  return (
    <div
      className="shrink-0 border-b border-border px-4 py-3"
      data-testid="open-thread-chrome"
    >
      <div className="flex items-center gap-2">
        {onBack ? (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 h-7 gap-1 px-2"
            onClick={onBack}
            aria-label={backAriaLabel}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        ) : null}
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {title}
        </h2>
        {actions}
      </div>
      {forkedFrom && onSourceConversation ? (
        <div className="mt-1.5 min-w-0">
          <ForkedThreadSourceLink
            sourceConversationId={forkedFrom}
            onSelect={onSourceConversation}
          />
        </div>
      ) : null}
      <div className="mt-2">
        <ThreadStatusStrip
          runActive={runActive}
          events={events}
          readOnly={readOnly}
        />
      </div>
    </div>
  );
}

export function ConversationThread({
  conversationId,
  onBack,
  backAriaLabel,
  headerActions,
  meta: metaProp,
  hideComposer,
}: {
  conversationId: string;
  onBack?: () => void;
  backAriaLabel?: string;
  /** Trailing controls in the open-thread chrome (e.g. channel overflow). */
  headerActions?: ReactNode;
  /**
   * Issue-anchored sessions are omitted from the Agents roster. Pass title +
   * model from the channel sessions list so the composer can mount.
   */
  meta?: {
    title: string;
    model: string;
    pendingMessage?: { text: string; at: string };
  };
  /** Read-only history (e.g. archived channel session) — transcript only. */
  hideComposer?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const {
    events,
    ready,
    streamRunActive,
    runResyncKey,
    pendingText,
    historyFailed,
    refetchHistory,
    isRefetchingHistory,
    historyError,
  } = useConversationEvents(conversationId, hostRef);
  const { runActive } = useConversationRunActive(
    conversationId,
    streamRunActive,
    runResyncKey,
  );
  const { data: conversations } = useConversationsQuery(true);
  const setSelectedConversationId = useAgentsUiStore(
    (s) => s.setSelectedConversationId,
  );
  const keyboardInset = useKeyboardInset();
  const listMeta = conversations?.find((c) => c.id === conversationId);
  const meta = listMeta ?? metaProp;
  const readOnly = listMeta?.readOnly === true;
  const forkedFrom = listMeta?.forkedFrom;
  const forkedAtSeq = listMeta?.forkedAtSeq;
  const title = meta?.title?.trim() || "Thread";
  const pendingMessageText =
    pendingText !== undefined
      ? pendingText
      : (meta?.pendingMessage?.text ?? null);

  return (
    // Give back the keyboard's height at the bottom: the chrome above stays put
    // while the transcript shortens and the composer rides above the keyboard.
    <div
      ref={hostRef}
      className="flex min-h-0 flex-1 flex-col"
      style={{ paddingBottom: keyboardInset }}
      data-testid="conversation-thread"
    >
      <OpenThreadChrome
        title={title}
        onBack={onBack}
        backAriaLabel={backAriaLabel}
        runActive={runActive}
        events={events}
        actions={headerActions}
        readOnly={readOnly}
        forkedFrom={forkedFrom}
        onSourceConversation={forkedFrom ? setSelectedConversationId : undefined}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ThreadBody
          events={events}
          ready={ready}
          historyFailed={historyFailed}
          historyErrorMessage={historyError?.message}
          isRefetchingHistory={isRefetchingHistory}
          onRetryHistory={() => void refetchHistory()}
          pendingMessageText={pendingMessageText}
          runActive={runActive}
          conversationId={conversationId}
          model={meta?.model ?? ""}
          keyboardInset={keyboardInset}
          forkedAtSeq={forkedAtSeq}
        />
      </div>
      {meta && !hideComposer ? (
        <>
          {readOnly ? <ForkedThreadComposerNotice /> : null}
          <Composer
            conversationId={conversationId}
            model={meta.model}
            runActive={runActive}
          />
        </>
      ) : null}
    </div>
  );
}
