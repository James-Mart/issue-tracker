import type { ReactNode } from "react";
import type { TranscriptEvent } from "@server/schemas";
import { ShellState } from "@/app/shell-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useConversationsQuery } from "../api/queries";
import { useConversationEvents } from "../hooks/use-conversation-events";
import {
  deriveSubAgents,
  isSubAgentToolCall,
  type SubAgent,
} from "../lib/subagent";
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
  // Index-stable for in-place assistant delta updates (avoid remounting
  // Markdown on every token). `at` changes each delta and is not usable.
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
    <div className="flex justify-end" data-event="prompt">
      <div className="max-w-[85%] rounded-lg border border-border bg-[hsl(var(--panel-2))] px-3.5 py-2.5">
        <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          You
        </p>
        <p className="whitespace-pre-wrap text-sm text-foreground">{text}</p>
      </div>
    </div>
  );
}

function AssistantEvent({ text }: { text: string }) {
  return (
    <div data-event="assistant">
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
    case "task": {
      const parts = [event.status, event.text].filter(Boolean);
      return (
        <InfoLine label="Task">
          {parts.length > 0 ? parts.join(" · ") : "update"}
        </InfoLine>
      );
    }
    case "status":
      return (
        <InfoLine label="Status">
          {event.status}
          {event.message ? ` — ${event.message}` : ""}
        </InfoLine>
      );
    case "usage": {
      const u = event.usage;
      return (
        <InfoLine label="Usage">
          {u.totalTokens.toLocaleString()} tokens
          {` · in ${u.inputTokens.toLocaleString()}`}
          {` · out ${u.outputTokens.toLocaleString()}`}
          {u.reasoningTokens !== undefined
            ? ` · reason ${u.reasoningTokens.toLocaleString()}`
            : ""}
        </InfoLine>
      );
    }
    case "request":
      // Informational only — Epic auto-run posture; never a blocking prompt.
      return <InfoLine label="Request">{event.requestId}</InfoLine>;
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
    <div
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4"
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
    </div>
  );
}

export function ConversationThread({
  conversationId,
}: {
  conversationId: string;
}) {
  const { events, ready } = useConversationEvents(conversationId);
  const { data: conversations } = useConversationsQuery();
  const meta = conversations?.find((c) => c.id === conversationId);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ThreadBody events={events} ready={ready} />
      </div>
      {meta ? (
        <Composer
          conversationId={conversationId}
          model={meta.model}
          events={events}
        />
      ) : null}
    </div>
  );
}
