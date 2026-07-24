import type { ReactNode } from "react";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils/cn";

type Tone = "neutral" | "blocked";

const eyebrowTone: Record<Tone, string> = {
  neutral: "text-[hsl(var(--current))]",
  blocked: "text-[hsl(var(--blocked))]",
};

/** Mono diagnostic + directive next-move line for fault surfaces. */
export function ShellFaultDetail({
  message,
  hint,
}: {
  message: string;
  hint: string;
}) {
  return (
    <>
      <span className="font-mono text-xs">{message}</span>
      <span className="mt-2 block">{hint}</span>
    </>
  );
}

/** Compact inline fault banner for section-level errors. */
export function ShellInlineFault({
  message,
  hint,
  className,
}: {
  message: string;
  hint: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-[hsl(var(--blocked)/0.45)] bg-[hsl(var(--blocked)/0.08)] px-3 py-2.5 text-sm text-muted-foreground",
        className,
      )}
      role="alert"
    >
      <ShellFaultDetail message={message} hint={hint} />
    </div>
  );
}

export function ShellState({
  tone = "neutral",
  eyebrow,
  title,
  detail,
  action,
  className,
}: {
  tone?: Tone;
  eyebrow?: string;
  title: string;
  detail?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const isFault = tone === "blocked";
  return (
    <Card
      className={cn("px-6 py-10 text-center", className)}
      role={isFault ? "alert" : "status"}
      aria-live={isFault ? "assertive" : undefined}
    >
      {eyebrow ? (
        <p
          className={cn(
            "font-display text-[11px] font-semibold uppercase tracking-[0.22em]",
            eyebrowTone[tone],
          )}
        >
          {eyebrow}
        </p>
      ) : null}
      <h2
        className={cn(
          "text-base font-semibold tracking-tight text-foreground",
          eyebrow ? "mt-3" : null,
        )}
      >
        {title}
      </h2>
      {detail ? (
        <div className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          {detail}
        </div>
      ) : null}
      {action ? (
        <div className="mt-5 flex justify-center gap-2">{action}</div>
      ) : null}
    </Card>
  );
}

/** Top-level loading placeholder: quiet skeletons + directive status copy. */
export function ShellLoadingState({ label }: { label: string }) {
  return (
    <Card
      className="px-6 py-8 text-center"
      role="status"
      aria-live="polite"
    >
      <p className="font-mono text-[11px] text-muted-foreground">{label}</p>
      <div className="mt-5 space-y-3 text-left">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-8 w-2/3" />
      </div>
    </Card>
  );
}

/**
 * Shared loading/error gate for pages driven by `useIssuesQuery`.
 * Success content is the caller's responsibility (usually a `PageShell`).
 */
export function IssuesQueryShell({
  isLoading,
  error,
  isFetching,
  onReload,
  loadingLabel,
  errorTitle,
  children,
}: {
  isLoading: boolean;
  error: Error | null | undefined;
  isFetching: boolean;
  onReload: () => void;
  loadingLabel: string;
  errorTitle: string;
  children: ReactNode;
}): ReactNode {
  if (isLoading) {
    return (
      <PageShell>
        <ShellLoadingState label={loadingLabel} />
      </PageShell>
    );
  }
  if (error) {
    return (
      <PageShell>
        <ShellState
          tone="blocked"
          eyebrow="Fault"
          title={errorTitle}
          detail={
            <ShellFaultDetail
              message={error.message}
              hint="Check the server, then reload."
            />
          }
          action={
            <Button
              variant="primary"
              disabled={isFetching}
              onClick={onReload}
            >
              Reload
            </Button>
          }
        />
      </PageShell>
    );
  }
  return children;
}
