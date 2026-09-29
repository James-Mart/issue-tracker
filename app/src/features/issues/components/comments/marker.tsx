import type { ReactNode } from "react";

export function commentDayKey(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? at : date.toDateString();
}

export function commentDayLabel(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function Marker({ children }: { children: ReactNode }) {
  return (
    <div className="my-1 flex items-center gap-3">
      <div className="h-px flex-1 bg-border" />
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {children}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}
