import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/** Mainline section eyebrow used on detail primary-column modules. */
export function DetailEyebrow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "font-display text-[11px] font-semibold uppercase tracking-[0.22em] text-[hsl(var(--current))]",
        className,
      )}
    >
      {children}
    </p>
  );
}

/**
 * One module on a settings surface: hairline card, eyebrow, and an optional
 * action aligned with it. Modules tile into a grid, so keep chrome minimal.
 */
export function SettingsCard({
  title,
  action,
  className,
  children,
}: {
  title: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col rounded-lg border border-border bg-card px-4 py-3.5",
        className,
      )}
    >
      <div className="mb-2.5 flex min-h-8 items-center justify-between gap-2">
        <DetailEyebrow>{title}</DetailEyebrow>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Column heading above hairline-separated rows in a settings table. */
export const SETTINGS_HEADING_CLASS =
  "font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground";
