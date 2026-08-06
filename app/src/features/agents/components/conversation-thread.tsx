import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import type { TranscriptEvent } from "@server/schemas";
import { ShellState } from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import { currentGlow, liveChip } from "@/components/ui/overlay-surfaces";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils/cn";
import { useConversationsQuery } from "../api/queries";
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
import { MessageScroller } from "@/features/issues/components/chat/message-scroller";
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
  // and is not usable. Consecutive thinking merges in applyTranscriptEvent,
  // so one stream chain maps to one index.
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
      <p className="whitespace-pre-wrap break-words">{message}</p>
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

function ThreadBody({
  events,
  ready,
}: {
  events: TranscriptEvent[];
  ready: boolean;
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

  if (events.length === 0) {
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
      bottomKey={transcriptScrollerBottomKey(events)}
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
}: {
  conversationId: string;
  onBack?: () => void;
}) {
  const { events, ready, streamRunActive, runResyncKey } =
    useConversationEvents(conversationId);
  const { runActive } = useConversationRunActive(
    conversationId,
    streamRunActive,
    runResyncKey,
  );
  const { data: conversations } = useConversationsQuery();
  const meta = conversations?.find((c) => c.id === conversationId);
  const title = meta?.title?.trim() || "Thread";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ThreadHeader
        title={title}
        onBack={onBack}
        runActive={runActive}
        events={events}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ThreadBody events={events} ready={ready} />
      </div>
      {meta ? (
        <Composer
          conversationId={conversationId}
          model={meta.model}
          runActive={runActive}
        />
      ) : null}
    </div>
  );
}
