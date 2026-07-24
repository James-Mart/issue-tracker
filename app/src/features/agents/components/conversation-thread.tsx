import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import type { TranscriptEvent } from "@server/schemas";
import { ShellInlineFault, ShellState } from "@/app/shell-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Markdown } from "@/features/issues/components/markdown";
import { cn } from "@/lib/utils/cn";
import { useConversationQuery } from "../api/queries";

function formatUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function toolStatusVariant(
  status: "running" | "completed" | "error",
): "inProgress" | "done" | "blocked" {
  if (status === "running") return "inProgress";
  if (status === "completed") return "done";
  return "blocked";
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

function CollapsibleDetails({
  label,
  children,
  className,
  summaryClassName,
  bodyClassName,
  ...detailsProps
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
  summaryClassName?: string;
  bodyClassName?: string;
} & Omit<ComponentPropsWithoutRef<"details">, "className" | "children">) {
  return (
    <details className={cn("group", className)} {...detailsProps}>
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center gap-1.5 font-mono text-[11px] text-muted-foreground marker:content-none [&::-webkit-details-marker]:hidden",
          summaryClassName,
        )}
      >
        <ChevronRight className="h-3 w-3 shrink-0 transition-transform group-open:rotate-90" />
        {label}
      </summary>
      <div className={cn("border-t border-border", bodyClassName)}>
        {children}
      </div>
    </details>
  );
}

function CollapsiblePayload({
  label,
  value,
}: {
  label: string;
  value: unknown;
}) {
  if (value === undefined) return null;
  return (
    <CollapsibleDetails
      label={label}
      className="mt-2 rounded-md border border-border bg-[hsl(var(--panel-2))]"
      summaryClassName="px-2.5 py-1.5"
      bodyClassName="px-2.5 py-2"
    >
      <pre className="max-h-64 overflow-auto font-mono text-[11px] leading-relaxed text-foreground/90">
        {formatUnknown(value)}
      </pre>
    </CollapsibleDetails>
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
    <div className="min-w-0" data-event="assistant">
      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[hsl(var(--current))]">
        Assistant
      </p>
      <Markdown>{text}</Markdown>
    </div>
  );
}

function ThinkingEvent({ text }: { text: string }) {
  return (
    <CollapsibleDetails
      label="Thinking"
      className="rounded-md border border-border bg-card"
      summaryClassName="px-3 py-2"
      bodyClassName="px-3 py-2"
      data-event="thinking"
    >
      <p className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted-foreground">
        {text}
      </p>
    </CollapsibleDetails>
  );
}

function ToolCallEvent({
  event,
}: {
  event: Extract<TranscriptEvent, { type: "tool_call" }>;
}) {
  const name = event.name?.trim() || "tool";
  return (
    <div
      className="rounded-md border border-border bg-card px-3 py-2.5"
      data-event="tool_call"
      data-call-id={event.callId}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-medium text-foreground">
          {name}
        </span>
        <Badge variant={toolStatusVariant(event.status)}>{event.status}</Badge>
        <span className="font-mono text-[10px] text-muted-foreground">
          {event.callId}
        </span>
      </div>
      <CollapsiblePayload label="Args" value={event.args} />
      <CollapsiblePayload label="Result" value={event.result} />
    </div>
  );
}

function TranscriptEventRow({ event }: { event: TranscriptEvent }) {
  switch (event.type) {
    case "prompt":
      return <PromptEvent text={event.text} />;
    case "assistant":
      return <AssistantEvent text={event.text} />;
    case "thinking":
      return <ThinkingEvent text={event.text} />;
    case "tool_call":
      return <ToolCallEvent event={event} />;
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
      return <InfoLine label="Request">{event.requestId}</InfoLine>;
    case "subagent_update":
      // Nested sub-agent thread lands in a later Story; ignore for now.
      return null;
    default:
      // Tolerate unknown future kinds without crashing.
      return null;
  }
}

export function ConversationThread({
  conversationId,
}: {
  conversationId: string;
}) {
  const { data, isLoading, error, refetch, isFetching } =
    useConversationQuery(conversationId);

  if (isLoading) {
    return (
      <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading transcript">
        <Skeleton className="ml-auto h-16 w-2/3" />
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-8 w-2/5" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <ShellInlineFault
          message={error.message}
          hint="Check the server, then reload the transcript."
        />
        <Button
          variant="primary"
          size="sm"
          className="mt-3"
          disabled={isFetching}
          onClick={() => refetch()}
        >
          Reload
        </Button>
      </div>
    );
  }

  const transcript = data?.transcript ?? [];
  if (transcript.length === 0) {
    return (
      <ShellState
        className="m-4 border-0 bg-transparent px-4 py-8 shadow-none"
        eyebrow="Empty"
        title="No transcript yet."
        detail="This conversation has no persisted turns. Live prompting arrives in a later story."
      />
    );
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4"
      role="log"
      aria-label="Conversation transcript"
      aria-relevant="additions"
    >
      {transcript.map((event, index) => (
        <TranscriptEventRow
          key={`${event.type}-${event.at}-${index}`}
          event={event}
        />
      ))}
    </div>
  );
}
