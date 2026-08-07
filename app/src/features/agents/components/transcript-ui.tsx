import {
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Markdown } from "@/features/issues/components/markdown";
import { summarizeToolCall } from "@/features/agents/lib/tool-summary";
import { cn } from "@/lib/utils/cn";

export type TranscriptDensity = "default" | "compact";

const densityPad = {
  default: {
    thinkingSummary: "px-3 py-2",
    thinkingBody: "px-3 py-2",
    tool: "px-3 py-2.5",
  },
  compact: {
    thinkingSummary: "px-2.5 py-1.5",
    thinkingBody: "px-2.5 py-2",
    tool: "px-2.5 py-2",
  },
} as const;

export function formatUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function toolStatusVariant(
  status: "running" | "completed" | "error",
): "inProgress" | "done" | "blocked" {
  if (status === "running") return "inProgress";
  if (status === "completed") return "done";
  return "blocked";
}

/** Stable list key for a tool_call row (top-level or nested). */
export function toolCallRowKey(callId: string): string {
  return `tool_call-${callId}`;
}

/**
 * Index-stable key for streaming text/thinking (and similar) rows so in-place
 * delta updates do not remount Markdown / details.
 */
export function indexedStreamKey(index: number, kind: string): string {
  return `${index}-${kind}`;
}

export function CollapsibleDetails({
  label,
  children,
  className,
  summaryClassName,
  bodyClassName,
  initiallyOpen,
  open: openProp,
  onToggle,
  ...detailsProps
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
  summaryClassName?: string;
  bodyClassName?: string;
  /** When set, starts open/closed and stays toggleable (controlled). */
  initiallyOpen?: boolean;
} & Omit<
  ComponentPropsWithoutRef<"details">,
  "className" | "children" | "open" | "onToggle"
> & {
    open?: boolean;
    onToggle?: (event: SyntheticEvent<HTMLDetailsElement>) => void;
  }) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(!!initiallyOpen);
  const controlledByProp = openProp !== undefined;
  const controlledByInitial = initiallyOpen !== undefined && !controlledByProp;
  const open = controlledByProp
    ? openProp
    : controlledByInitial
      ? uncontrolledOpen
      : undefined;

  return (
    <details
      className={cn("group", className)}
      {...detailsProps}
      {...(open !== undefined ? { open } : {})}
      onToggle={(event) => {
        if (controlledByInitial) {
          setUncontrolledOpen(event.currentTarget.open);
        }
        onToggle?.(event);
      }}
    >
      <summary
        className={cn(
          "flex min-h-11 cursor-pointer list-none items-center gap-1.5 font-mono text-[11px] text-muted-foreground marker:content-none [&::-webkit-details-marker]:hidden",
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

export function CollapsiblePayload({
  label,
  value,
  initiallyOpen,
}: {
  label: string;
  value: unknown;
  initiallyOpen?: boolean;
}) {
  if (value === undefined) return null;
  return (
    <CollapsibleDetails
      label={label}
      className="mt-2 min-w-0 rounded-md border border-border bg-[hsl(var(--panel-2))]"
      summaryClassName="px-2.5 py-1.5"
      bodyClassName="min-w-0 px-2.5 py-2"
      {...(initiallyOpen !== undefined ? { initiallyOpen } : {})}
    >
      <pre className="max-h-64 min-w-0 overflow-x-auto overflow-y-auto whitespace-pre font-mono text-[11px] leading-relaxed text-foreground/90">
        {formatUnknown(value)}
      </pre>
    </CollapsibleDetails>
  );
}

/** Markdown body shared by top-level assistant text and nested sub-agent text. */
export function TranscriptMarkdownText({
  text,
  className,
  ...attrs
}: {
  text: string;
  className?: string;
} & ComponentPropsWithoutRef<"div">) {
  return (
    <div className={cn("min-w-0 break-words", className)} {...attrs}>
      <Markdown>{text}</Markdown>
    </div>
  );
}

export function TranscriptThinking({
  text,
  open,
  density = "default",
  ...attrs
}: {
  text: string;
  /** Force-open while this block is the live tip of the stream. */
  open?: boolean;
  density?: TranscriptDensity;
} & Omit<ComponentPropsWithoutRef<"details">, "children" | "open">) {
  const pad = densityPad[density];
  return (
    <CollapsibleDetails
      label="Thinking"
      className="min-w-0 rounded-md border border-border bg-card"
      summaryClassName={pad.thinkingSummary}
      bodyClassName={pad.thinkingBody}
      {...attrs}
      // Only force-open while this block is still the live tip of the stream;
      // omit the attr otherwise so users can toggle historical thinking freely.
      {...(open ? { open: true } : {})}
    >
      <p className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-muted-foreground">
        {text}
      </p>
    </CollapsibleDetails>
  );
}

function ToolCallPayloadSection({
  label,
  value,
}: {
  label: string;
  value: unknown;
}) {
  if (value === undefined) return null;
  return (
    <div className="min-w-0">
      <div className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <pre className="mt-1 max-h-64 min-w-0 overflow-x-auto overflow-y-auto whitespace-pre font-mono text-[11px] leading-relaxed text-foreground/90">
        {formatUnknown(value)}
      </pre>
    </div>
  );
}

export function TranscriptToolCall({
  callId,
  name,
  status,
  args,
  result,
  density = "default",
  className,
  ...attrs
}: {
  callId: string;
  name?: string | null;
  status: "running" | "completed" | "error";
  args?: unknown;
  result?: unknown;
  density?: TranscriptDensity;
  className?: string;
} & Omit<ComponentPropsWithoutRef<"details">, "children">) {
  const { label, detail } = summarizeToolCall(name, args);
  const running = status === "running";
  const pad = densityPad[density];
  return (
    <CollapsibleDetails
      className={cn("min-w-0 rounded-md border border-border bg-card", className)}
      summaryClassName={cn(
        "min-h-0 gap-2",
        pad.tool,
        density === "compact" && "py-1.5",
      )}
      bodyClassName={cn("space-y-2 px-3 py-2", density === "compact" && "px-2.5 py-1.5")}
      initiallyOpen={status === "error"}
      label={
        <>
          <Badge
            variant={toolStatusVariant(status)}
            className={cn("shrink-0 text-[10px]", running && "animate-pulse")}
          >
            {status}
          </Badge>
          <span className="shrink-0 font-mono text-xs font-medium text-foreground">
            {label}
          </span>
          {detail ? (
            <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
              {detail}
            </span>
          ) : null}
        </>
      }
      {...attrs}
      data-call-id={callId}
      data-status={status}
    >
      <ToolCallPayloadSection label="Args" value={args} />
      <ToolCallPayloadSection label="Result" value={result} />
      <span className="block min-w-0 break-all font-mono text-[10px] text-muted-foreground">
        {callId}
      </span>
    </CollapsibleDetails>
  );
}
