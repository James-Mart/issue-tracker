import type { ReactNode } from "react";
import { READING_MEASURE_CLASS } from "@/components/page-shell";
import { cn } from "@/lib/utils/cn";

/** Human composer side; everything else is an agent/system turn. */
export function isHumanRole(role: string): boolean {
  return role === "human";
}

export function Message({
  author,
  role,
  at,
  children,
}: {
  author: string;
  role: string;
  at: string;
  children: ReactNode;
}) {
  const time = formatTime(at);
  const showRole = role !== author;

  return (
    <article className="flex flex-col gap-1.5 border-b border-border py-3 last:border-b-0">
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
        {showRole ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.14em]">
            {role}
          </span>
        ) : null}
        <span className="font-medium text-foreground/80">{author}</span>
        {time ? <time dateTime={at}>{time}</time> : null}
      </header>
      <div className={cn("min-w-0", READING_MEASURE_CLASS)}>{children}</div>
    </article>
  );
}

function formatTime(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
