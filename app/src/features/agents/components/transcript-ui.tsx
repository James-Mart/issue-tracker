import {
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";

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
