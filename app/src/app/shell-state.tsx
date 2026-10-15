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
  onMessageClick,
  messageTestId,
}: {
  message: string;
  hint: string;
  /** The diagnostic line opens something. The hint stays static. */
  onMessageClick?: () => void;
  messageTestId?: string;
}) {
  const diagnostic = onMessageClick ? (
    <button
      type="button"
      className="min-h-11 w-full text-left font-mono text-xs text-[hsl(var(--current))] underline underline-offset-2"
      data-testid={messageTestId}
      onClick={onMessageClick}
    >
      {message}
    </button>
  ) : (
    <span className="font-mono text-xs">{message}</span>
  );
  return (
    <>
      {diagnostic}
      <span className="mt-2 block">{hint}</span>
    </>
  );
}

/** Compact inline fault banner for section-level errors. `action` sits at the trailing edge. */
export function ShellInlineFault({
  message,
  hint,
  action,
  className,
  onMessageClick,
  messageTestId,
}: {
  message: string;
  hint: string;
  action?: ReactNode;
  className?: string;
  onMessageClick?: () => void;
  messageTestId?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-[hsl(var(--blocked)/0.45)] bg-[hsl(var(--blocked)/0.08)] px-3 py-2.5 text-sm text-muted-foreground",
        action != null && "flex flex-wrap items-center gap-x-3 gap-y-2",
        className,
      )}
      role="alert"
    >
      {action != null ? (
        <>
          <div className="min-w-0 flex-1">
            <ShellFaultDetail
              message={message}
              hint={hint}
              onMessageClick={onMessageClick}
              messageTestId={messageTestId}
            />
          </div>
          <div className="ml-auto shrink-0">{action}</div>
        </>
      ) : (
        <ShellFaultDetail
          message={message}
          hint={hint}
          onMessageClick={onMessageClick}
          messageTestId={messageTestId}
        />
      )}
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
function QueryShellBody({
  columnClassName,
  children,
}: {
  columnClassName?: string;
  children: ReactNode;
}) {
  if (!columnClassName) return children;
  return <div className={columnClassName}>{children}</div>;
}

export function IssuesQueryShell({
  isLoading,
  error,
  isFetching,
  onReload,
  loadingLabel,
  errorTitle,
  columnClassName,
  children,
}: {
  isLoading: boolean;
  error: Error | null | undefined;
  isFetching: boolean;
  onReload: () => void;
  loadingLabel: string;
  errorTitle: string;
  /** When set, loading/error bodies share this centered column wrapper. */
  columnClassName?: string;
  children: ReactNode;
}): ReactNode {
  if (isLoading) {
    return (
      <PageShell>
        <QueryShellBody columnClassName={columnClassName}>
          <ShellLoadingState label={loadingLabel} />
        </QueryShellBody>
      </PageShell>
    );
  }
  if (error) {
    return (
      <PageShell>
        <QueryShellBody columnClassName={columnClassName}>
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
        </QueryShellBody>
      </PageShell>
    );
  }
  return children;
}
