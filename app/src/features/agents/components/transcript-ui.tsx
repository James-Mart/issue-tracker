import {
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Markdown } from "@/features/issues/components/markdown";
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
      className="mt-2 rounded-md border border-border bg-[hsl(var(--panel-2))]"
      summaryClassName="px-2.5 py-1.5"
      bodyClassName="px-2.5 py-2"
      {...(initiallyOpen !== undefined ? { initiallyOpen } : {})}
    >
      <pre className="max-h-64 overflow-auto font-mono text-[11px] leading-relaxed text-foreground/90">
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
    <div className={cn("min-w-0", className)} {...attrs}>
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
      className="rounded-md border border-border bg-card"
      summaryClassName={pad.thinkingSummary}
      bodyClassName={pad.thinkingBody}
      {...attrs}
      // Only force-open while this block is still the live tip of the stream;
      // omit the attr otherwise so users can toggle historical thinking freely.
      {...(open ? { open: true } : {})}
    >
      <p className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted-foreground">
        {text}
      </p>
    </CollapsibleDetails>
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
} & Omit<ComponentPropsWithoutRef<"div">, "children">) {
  const toolName = name?.trim() || "tool";
  const running = status === "running";
  return (
    <div
      className={cn(
        "rounded-md border border-border bg-card",
        densityPad[density].tool,
        className,
      )}
      {...attrs}
      data-call-id={callId}
      data-status={status}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-medium text-foreground">
          {toolName}
        </span>
        <Badge
          variant={toolStatusVariant(status)}
          className={running ? "animate-pulse" : undefined}
        >
          {status}
        </Badge>
        <span className="font-mono text-[10px] text-muted-foreground">
          {callId}
        </span>
      </div>
      <CollapsiblePayload label="Args" value={args} />
      <CollapsiblePayload label="Result" value={result} />
    </div>
  );
}
