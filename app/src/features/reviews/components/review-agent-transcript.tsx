import { useMemo, useRef } from "react";
import type { TranscriptEvent } from "@server/schemas";
import { ShellInlineFault } from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageScroller } from "@/components/ui/message-scroller";
import { useConversationEvents } from "@/features/agents/hooks/use-conversation-events";
import { deriveSubAgents, isSubAgentToolCall } from "@/features/agents/lib/subagent";
import { transcriptScrollerBottomKey } from "@/features/agents/lib/transcript-scroller";
import {
  groupOrdinaryToolCalls,
  isLiveThinking,
  transcriptInfoLine,
} from "@/features/agents/lib/transcript-rows";
import { SubagentCard } from "@/features/agents/components/subagent-card";
import {
  indexedStreamKey,
  toolCallRowKey,
  TranscriptMarkdownText,
  TranscriptThinking,
  TranscriptToolCall,
  ToolUseGroup,
} from "@/features/agents/components/transcript-ui";

/**
 * The launch prompt is the role body. The card follows the run's messages,
 * tool calls, and errors; nested delegates stay in this transcript.
 */
function cardEvents(events: readonly TranscriptEvent[]): TranscriptEvent[] {
  return events.filter((event) => event.type !== "prompt");
}

function TranscriptRows({ events }: { events: readonly TranscriptEvent[] }) {
  const visible = useMemo(() => cardEvents(events), [events]);
  const subAgentsByCallId = useMemo(() => {
    const agents = deriveSubAgents(visible);
    return new Map(agents.map((agent) => [agent.callId, agent]));
  }, [visible]);
  const segments = useMemo(() => groupOrdinaryToolCalls(visible), [visible]);

  return segments.map((segment, index) => {
    if (segment.kind === "tool_use_group") {
      const first = segment.events[0]!;
      return (
        <ToolUseGroup
          key={`tool_use_group-${first.callId}`}
          tools={segment.events}
          density="compact"
        />
      );
    }

    const event = segment.event;
    const eventIndex = visible.indexOf(event);
    if (event.type === "assistant") {
      if (event.text.length === 0) return null;
      return (
        <TranscriptMarkdownText
          key={indexedStreamKey(eventIndex, "assistant")}
          text={event.text}
          data-event="assistant"
        />
      );
    }
    if (event.type === "thinking") {
      return (
        <TranscriptThinking
          key={indexedStreamKey(eventIndex, "thinking")}
          text={event.text}
          density="compact"
          open={isLiveThinking(visible, eventIndex)}
          data-event="thinking"
        />
      );
    }
    if (event.type === "tool_call" && isSubAgentToolCall(event)) {
      const agent = subAgentsByCallId.get(event.callId);
      if (agent) {
        return <SubagentCard key={toolCallRowKey(event.callId)} agent={agent} />;
      }
    }
    if (event.type === "tool_call") {
      return (
        <TranscriptToolCall
          key={toolCallRowKey(event.callId)}
          callId={event.callId}
          name={event.name}
          status={event.status}
          args={event.args}
          result={event.result}
          density="compact"
          data-event="tool_call"
        />
      );
    }
    if (event.type === "error") {
      return (
        <div
          key={indexedStreamKey(index, "error")}
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground"
          data-event="error"
        >
          <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-destructive">
            Error
          </p>
          <p className="whitespace-pre-wrap break-words font-mono text-xs">{event.message}</p>
        </div>
      );
    }
    const info = transcriptInfoLine(event);
    if (!info) return null;
    return (
      <p
        key={indexedStreamKey(index, event.type)}
        className="font-mono text-[11px] text-muted-foreground"
        data-event={event.type}
      >
        <span className="uppercase tracking-[0.08em]">{info.label}</span> {info.text}
      </p>
    );
  });
}

/** Conversation transcript for one review run, following the latest message while pinned. */
export function ReviewAgentTranscript({ conversationId }: { conversationId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const history = useConversationEvents(conversationId, hostRef);
  const waiting = !history.ready && history.events.length === 0;

  if (history.historyFailed && history.events.length === 0) {
    return (
      <div
        className="border-t border-border px-3 py-3"
        data-slot="agent-run-body"
        data-state="error"
      >
        <ShellInlineFault
          message={history.historyError?.message ?? "Could not load the transcript."}
          hint="Expand again later or reload the page."
          action={
            <Button
              type="button"
              size="sm"
              disabled={history.isRefetchingHistory}
              onClick={() => void history.refetchHistory()}
            >
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  if (waiting) {
    return (
      <div
        className="space-y-2 border-t border-border px-3 py-3"
        data-slot="agent-run-body"
        data-state="loading"
        aria-busy="true"
        aria-label="Loading run transcript"
      >
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  return (
    <div ref={hostRef} className="border-t border-border" data-slot="agent-run-body" data-state="ready">
      <MessageScroller
        bottomKey={transcriptScrollerBottomKey(history.events)}
        className="max-h-96 px-3 py-3"
        role="log"
        aria-label="Run transcript"
      >
        <TranscriptRows events={history.events} />
      </MessageScroller>
    </div>
  );
}
