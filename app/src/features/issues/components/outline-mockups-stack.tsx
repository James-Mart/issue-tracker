import type { ReactNode } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import type { OutlineMockupStackStatus } from "@server/schemas";
import { ShellState } from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { currentGlow, liveChip } from "@/components/ui/overlay-surfaces";
import { cn } from "@/lib/utils/cn";
import { outlineStorybookPath } from "../api/outline-mockups";

const EMPTY_DETAIL =
  "Accept a design direction during planning, or resume the mockup author after the outline exists, to attach a replay bundle here.";

function DirectionsList({ ids }: { ids: readonly string[] }) {
  if (ids.length === 0) return null;
  return (
    <ul
      className="mt-3 hidden space-y-1.5 text-left text-sm text-muted-foreground shell:block"
      data-testid="outline-mockups-directions"
    >
      {ids.map((id) => (
        <li key={id}>
          <span className="font-mono text-xs text-[hsl(var(--current))]">{id}</span>
        </li>
      ))}
    </ul>
  );
}

function ButtonRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap justify-center gap-2", className)}>{children}</div>;
}

function failureLog(status: OutlineMockupStackStatus): string {
  const tail = status.outputTail ?? "";
  if (!status.command) return tail;
  if (tail.includes(status.command)) return tail;
  return tail ? `> ${status.command}\n${tail}` : `> ${status.command}`;
}

function StartDetail({ status }: { status: OutlineMockupStackStatus }) {
  const session = status.sessionId ? (
    <span className="whitespace-nowrap font-mono text-xs text-foreground/90">
      {status.sessionId}
    </span>
  ) : null;
  if (status.authorRun === "clean" && session && status.directions.length > 0) {
    return (
      <>
        Restore this outline&apos;s saved bundle into session {session} and start the stack.
        Storybook opens on this host — not embedded in the tab.
      </>
    );
  }
  if (session) {
    return (
      <>
        Start Storybook on the tree session {session} is editing. It opens on this host — not
        embedded in the tab.
      </>
    );
  }
  return (
    <>
      This outline has saved mockups. Storybook opens on this host once a forked mockup-author
      session is bound.
    </>
  );
}

function EmptyStack() {
  return (
    <div data-testid="outline-mockups-empty">
      <ShellState
        className="border-0 bg-transparent px-4 py-8 shadow-none"
        title="No mockups for this outline."
        detail={EMPTY_DETAIL}
      />
    </div>
  );
}

function StartStack({
  status,
  pending,
  onStart,
}: {
  status: OutlineMockupStackStatus;
  pending: boolean;
  onStart: () => void;
}) {
  return (
    <Card
      className="mx-auto box-border w-full min-w-0 max-w-lg px-4 py-4 text-center shell:px-6 shell:py-8"
      data-testid="outline-mockups-start"
    >
      <h2 className="text-base font-semibold text-foreground">Storybook is not running.</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        <StartDetail status={status} />
      </p>
      <DirectionsList ids={status.directions} />
      <ButtonRow className="mt-4 shell:mt-6">
        <Button
          type="button"
          variant="current"
          className="min-w-[10rem]"
          disabled={pending}
          onClick={onStart}
        >
          Start mockups stack
        </Button>
      </ButtonRow>
      <p className="mt-3 hidden font-mono text-[10px] text-muted-foreground shell:block">
        After start succeeds, use Open Storybook on the next visit.
      </p>
    </Card>
  );
}

function FailureStack({
  status,
  pending,
  onStart,
}: {
  status: OutlineMockupStackStatus;
  pending: boolean;
  onStart: () => void;
}) {
  return (
    <Card
      className="box-border w-full min-w-0 max-w-full overflow-hidden border-[hsl(var(--blocked)/0.45)]"
      data-testid="outline-mockups-failure"
    >
      <div className="flex w-full max-w-full flex-col gap-1.5 border-b border-border bg-[hsl(var(--blocked)/0.08)] px-2.5 py-2 shell:flex-row shell:items-center shell:justify-between shell:gap-3 shell:px-4 shell:py-2.5">
        <p className="min-w-0 font-display text-[11px] font-semibold uppercase tracking-[0.22em] text-[hsl(var(--blocked))]">
          Storybook failed to start
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full shrink-0 justify-center gap-1.5 shell:w-auto"
          disabled={pending}
          onClick={onStart}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </Button>
      </div>
      <div className="box-border w-full max-w-full bg-background/60 p-1.5 shell:max-h-48 shell:overflow-y-auto shell:p-4">
        <pre className="m-0 block w-full max-w-full whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground/90">
          {failureLog(status)}
        </pre>
      </div>
    </Card>
  );
}

function LiveChip() {
  return (
    <span className={cn(liveChip, "shrink-0")} aria-live="polite">
      <span
        aria-hidden
        className={cn(
          "h-[7px] w-[7px] shrink-0 rounded-full bg-[hsl(var(--current))] motion-safe:animate-live-dot",
          currentGlow,
        )}
      />
      Live
    </span>
  );
}

function LiveStack({
  status,
  pending,
  onStop,
}: {
  status: OutlineMockupStackStatus;
  pending: boolean;
  onStop: () => void;
}) {
  const path = status.sessionId ? outlineStorybookPath(status.sessionId) : undefined;
  return (
    <Card
      className="mx-auto box-border w-full min-w-0 max-w-2xl px-4 py-4 shell:px-6 shell:py-8"
      data-testid="outline-mockups-live"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center justify-between gap-2 shell:block">
            <h2 className="text-base font-semibold text-foreground">
              Storybook is live on this host.
            </h2>
            <span className="shell:hidden">
              <LiveChip />
            </span>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground shell:mt-2">
            Open Storybook in a new tab. The tab keeps your mockup-author chat; it does not embed
            the canvas or a phone pager.
          </p>
          {path ? (
            <p className="mt-2 font-mono text-xs text-[hsl(var(--current))] [overflow-wrap:anywhere] shell:mt-3">
              {path}
            </p>
          ) : null}
          <DirectionsList ids={status.directions} />
        </div>
        <span className="hidden shrink-0 shell:inline-flex">
          <LiveChip />
        </span>
      </div>
      <ButtonRow className="mt-4 shell:mt-6">
        {path ? (
          <Button asChild variant="current">
            <a href={path} target="_blank" rel="noreferrer" data-testid="outline-mockups-open">
              Open Storybook
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        ) : null}
        <Button type="button" variant="outline" disabled={pending} onClick={onStop}>
          Stop stack
        </Button>
      </ButtonRow>
    </Card>
  );
}

/** Stack controls for one outline. The forked session's chat sits beside this. */
export function OutlineMockupsStack({
  status,
  pending,
  onStart,
  onStop,
}: {
  status: OutlineMockupStackStatus;
  pending: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  if (status.phase === "live") {
    return <LiveStack status={status} pending={pending} onStop={onStop} />;
  }
  if (status.phase === "failed") {
    return <FailureStack status={status} pending={pending} onStart={onStart} />;
  }
  if (status.canRestore) {
    return <StartStack status={status} pending={pending} onStart={onStart} />;
  }
  return <EmptyStack />;
}
