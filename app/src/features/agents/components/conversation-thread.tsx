import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Send, X } from "lucide-react";
import type { TranscriptEvent } from "@server/schemas";
import { ShellState } from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { currentGlow, liveChip } from "@/components/ui/overlay-surfaces";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils/cn";
import { useConversationsQuery } from "../api/queries";
import {
  useClearConversationPending,
  useSendConversationMessage,
  useUpdateConversationPending,
} from "../api/mutations";
import { useConversationEvents } from "../hooks/use-conversation-events";
import { useConversationRunActive } from "../hooks/use-conversation-run-active";
import {
  deriveSubAgents,
  isSubAgentToolCall,
  type SubAgent,
} from "../lib/subagent";
import { transcriptInfoLine } from "../lib/transcript-rows";
import {
  formatUsageTotals,
  sumUsageTotals,
  threadRunLabel,
} from "../lib/thread-status";
import { MessageScroller } from "@/components/ui/message-scroller";
import { transcriptScrollerBottomKey } from "../lib/transcript-scroller";
import { Composer } from "./composer";
import { SubagentCard } from "./subagent-card";
import {
  indexedStreamKey,
  toolCallRowKey,
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

function PromptEvent({ text }: { text: string }) {
  return (
    <div className="flex min-w-0 justify-end" data-event="prompt">
      <div className="min-w-0 max-w-[min(85%,100%)] rounded-lg border border-border bg-[hsl(var(--panel-2))] px-3.5 py-2.5">
        <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          You
        </p>
        <p className="whitespace-pre-wrap break-words text-sm text-foreground">
          {text}
        </p>
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
}: {
  event: TranscriptEvent;
  subAgentsByCallId: Map<string, SubAgent>;
  thinkingOpen?: boolean;
}) {
  switch (event.type) {
    case "prompt":
      return <PromptEvent text={event.text} />;
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
    case "request": {
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

function PendingMessageRow({
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

function ThreadBody({
  events,
  ready,
  pendingMessageText,
  runActive,
  conversationId,
  model,
}: {
  events: TranscriptEvent[];
  ready: boolean;
  pendingMessageText: string | null;
  runActive: boolean;
  conversationId: string;
  model: string;
}) {
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

  return (
    <MessageScroller
      bottomKey={transcriptScrollerBottomKey(events, pendingMessageText)}
      className="min-w-0 overflow-x-hidden px-4 py-4"
      role="log"
      aria-label="Conversation transcript"
      aria-live="polite"
      aria-relevant="additions text"
    >
      {events.map((event, index) => (
        <TranscriptEventRow
          key={eventKey(event, index)}
          event={event}
          subAgentsByCallId={subAgentsByCallId}
          thinkingOpen={
            event.type === "thinking" && isLiveThinking(events, index)
          }
        />
      ))}
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
}: {
  runActive: boolean;
  events: TranscriptEvent[];
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
      <span className="min-w-0 font-mono text-[11px] tabular-nums text-muted-foreground">
        {usageText}
      </span>
    </div>
  );
}

function ThreadHeader({
  title,
  onBack,
  runActive,
  events,
}: {
  title: string;
  onBack?: () => void;
  runActive: boolean;
  events: TranscriptEvent[];
}) {
  return (
    <div className="shrink-0 border-b border-border px-4 py-3">
      <div className="flex items-center gap-2">
        {onBack ? (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 h-7 gap-1 px-2"
            onClick={onBack}
            aria-label="Back to conversations"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        ) : null}
        <h2 className="min-w-0 truncate text-sm font-medium text-foreground">
          {title}
        </h2>
      </div>
      <div className="mt-2">
        <ThreadStatusStrip runActive={runActive} events={events} />
      </div>
    </div>
  );
}

export function ConversationThread({
  conversationId,
  onBack,
  meta: metaProp,
  hideComposer,
}: {
  conversationId: string;
  onBack?: () => void;
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
  const { events, ready, streamRunActive, runResyncKey, pendingText } =
    useConversationEvents(conversationId);
  const { runActive } = useConversationRunActive(
    conversationId,
    streamRunActive,
    runResyncKey,
  );
  const { data: conversations } = useConversationsQuery(true);
  const listMeta = conversations?.find((c) => c.id === conversationId);
  const meta = listMeta ?? metaProp;
  const title = meta?.title?.trim() || "Thread";
  const pendingMessageText =
    pendingText !== undefined
      ? pendingText
      : (meta?.pendingMessage?.text ?? null);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ThreadHeader
        title={title}
        onBack={onBack}
        runActive={runActive}
        events={events}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ThreadBody
          events={events}
          ready={ready}
          pendingMessageText={pendingMessageText}
          runActive={runActive}
          conversationId={conversationId}
          model={meta?.model ?? ""}
        />
      </div>
      {meta && !hideComposer ? (
        <Composer
          conversationId={conversationId}
          model={meta.model}
          runActive={runActive}
        />
      ) : null}
    </div>
  );
}
