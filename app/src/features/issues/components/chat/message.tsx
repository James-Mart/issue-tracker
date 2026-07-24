import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils/cn";

export type MessageAlign = "start" | "end";

/** Human composer side; everything else is an agent/system turn. */
export function isHumanRole(role: string): boolean {
  return role === "human";
}

export function alignOf(role: string): MessageAlign {
  return isHumanRole(role) ? "end" : "start";
}

/** Index of the latest non-human message — the single live avatar candidate. */
export function lastAgentMessageIndex(
  messages: readonly { role: string }[],
): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (!isHumanRole(messages[i]!.role)) return i;
  }
  return -1;
}

export function Message({
  author,
  role,
  at,
  live = false,
  children,
}: {
  author: string;
  role: string;
  at: string;
  /** Current glow on this agent avatar (single live point in the thread). */
  live?: boolean;
  children: ReactNode;
}) {
  const time = formatTime(at);
  const human = isHumanRole(role);
  const showRole = role !== author;

  return (
    <div
      className={cn(
        "flex w-full items-end gap-2",
        human ? "flex-row-reverse" : "flex-row",
      )}
    >
      <Avatar name={author} size="sm" live={live && !human} />
      <div
        className={cn(
          "max-w-[85%] rounded-lg border px-3 py-2",
          human
            ? "border-[hsl(var(--current)/0.35)] bg-[hsl(var(--current)/0.1)]"
            : "border-border bg-card",
        )}
      >
        <div className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
          <span
            className={cn(
              "font-medium",
              human ? "text-[hsl(var(--current))]" : "text-foreground/80",
            )}
          >
            {author}
          </span>
          {showRole ? (
            <span className="font-mono text-[10px] uppercase tracking-[0.14em]">
              {role}
            </span>
          ) : null}
          {time ? <time dateTime={at}>{time}</time> : null}
        </div>
        {children}
      </div>
    </div>
  );
}

function formatTime(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
