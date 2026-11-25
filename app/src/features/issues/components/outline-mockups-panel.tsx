import { useState } from "react";
import type { OutlineMockupStackStatus } from "@server/schemas";
import { ShellInlineFault, ShellLoadingState } from "@/app/shell-state";
import {
  ConversationThread,
  OpenThreadChrome,
} from "@/features/agents/components/conversation-thread";
import {
  useOutlineMockupStackQuery,
  useStartOutlineMockupStack,
  useStopOutlineMockupStack,
} from "../api/outline-mockups";
import { useChannelSessionsQuery } from "../api/queries";
import { issueDetailChannelLabel } from "../lib/issue-detail-tabs";
import { OutlineChannelBusyNote } from "./outline-channel-busy-note";
import { OutlineMockupsStack } from "./outline-mockups-stack";

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function ForkedSessionLine({ sessionId }: { sessionId: string }) {
  return (
    <div
      className="flex max-w-full flex-col gap-0.5 border-b border-border/60 px-2.5 py-1.5 shell:flex-row shell:items-baseline shell:justify-between shell:gap-2 shell:px-3 shell:py-2"
      data-testid="outline-mockups-session"
    >
      <div className="min-w-0">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
          Session{" "}
        </span>
        <span className="font-mono text-xs text-foreground/90">{sessionId}</span>
      </div>
      <span className="font-mono text-[10px] text-muted-foreground">forked from mockup author</span>
    </div>
  );
}

function busyOutlineChannel(
  planningActive: boolean,
  decompositionActive: boolean,
): "planning" | "decomposition" | undefined {
  if (planningActive) return "planning";
  if (decompositionActive) return "decomposition";
  return undefined;
}

/**
 * Mockups tab: Storybook start, open, and stop for the bound session, and
 * that session's chat when the outline has a forked mockup author.
 */
export function OutlineMockupsPanel({
  issueId,
  projectId,
  mobileFullViewport = false,
  onBackToOverview,
}: {
  issueId: string;
  projectId: string;
  mobileFullViewport?: boolean;
  onBackToOverview?: () => void;
}) {
  const stack = useOutlineMockupStackQuery(issueId, { refetchInterval: 3000 });
  const start = useStartOutlineMockupStack(issueId);
  const stop = useStopOutlineMockupStack(issueId);
  const planning = useChannelSessionsQuery(issueId, "planning");
  const decomposition = useChannelSessionsQuery(issueId, "decomposition");
  const mockups = useChannelSessionsQuery(issueId, "mockups");
  const [actionError, setActionError] = useState<string | null>(null);

  const mobileBack =
    mobileFullViewport && onBackToOverview
      ? { onBack: onBackToOverview, backAriaLabel: "Back to overview" }
      : undefined;
  const pending = start.isPending || stop.isPending;
  const status = stack.data;
  const bound = status?.sessionId
    ? mockups.data?.find((session) => session.id === status.sessionId)
    : undefined;
  const planningBusy = planning.data?.find((session) => session.activeRun);
  const decompositionBusy = decomposition.data?.find((session) => session.activeRun);
  const busyChannel = busyOutlineChannel(
    planningBusy !== undefined,
    decompositionBusy !== undefined,
  );
  const busyRun =
    busyChannel === "planning"
      ? planningBusy
      : busyChannel === "decomposition"
        ? decompositionBusy
        : undefined;

  const runStart = () => {
    setActionError(null);
    start.mutate(undefined, {
      onError: (err) => setActionError(errorText(err, "The mockups stack did not start.")),
    });
  };
  const runStop = () => {
    setActionError(null);
    stop.mutate(undefined, {
      onError: (err) => setActionError(errorText(err, "The mockups stack did not stop.")),
    });
  };

  if (stack.isLoading && !status) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {mobileBack ? (
          <OpenThreadChrome
            title="Mockups"
            onBack={mobileBack.onBack}
            backAriaLabel={mobileBack.backAriaLabel}
            runActive={false}
            events={[]}
          />
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ShellLoadingState label="Loading mockups" />
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <ShellInlineFault
          message={errorText(stack.error, "Mockups status failed to load.")}
          hint="Reload the outline to read the stack again."
        />
      </div>
    );
  }

  const fault =
    actionError && status.phase !== "failed" ? (
      <div className="shrink-0 px-1 pb-2">
        <ShellInlineFault message={actionError} hint="The stack was not changed." />
      </div>
    ) : null;
  const stackView = (
    <div className="shrink-0 px-1 py-3 shell:px-0">
      {fault}
      <OutlineMockupsStack status={status} pending={pending} onStart={runStart} onStop={runStop} />
    </div>
  );

  if (!status.sessionId) {
    return (
      <div
        className="flex min-h-0 flex-1 flex-col overflow-y-auto"
        data-testid="outline-mockups-panel"
      >
        {mobileBack ? (
          <OpenThreadChrome
            title="Mockups"
            onBack={mobileBack.onBack}
            backAriaLabel={mobileBack.backAriaLabel}
            runActive={false}
            events={[]}
          />
        ) : null}
        {stackView}
      </div>
    );
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-y-auto"
      data-testid="outline-mockups-panel"
    >
      {stackView}
      {bound ? (
        // The pane is shorter than the stack card plus the thread chrome.
        // A floor on the thread keeps the author's reply scrollable instead
        // of collapsing under the composer.
        <div className="flex min-h-[24rem] flex-1 flex-col">
          <ConversationThread
            conversationId={bound.id}
            meta={{ title: bound.title, model: bound.model }}
            onBack={mobileBack?.onBack}
            backAriaLabel={mobileBack?.backAriaLabel}
            composerDisabled={busyChannel !== undefined}
            composerDisabledPlaceholder={
              busyChannel
                ? `Open ${issueDetailChannelLabel(busyChannel)} to supervise the live run.`
                : undefined
            }
            composerNote={
              busyRun && busyChannel ? (
                <OutlineChannelBusyNote
                  projectId={projectId}
                  issueId={issueId}
                  channel={busyChannel}
                  runTitle={busyRun.title}
                />
              ) : undefined
            }
            banner={<ForkedSessionLine sessionId={status.sessionId} />}
          />
        </div>
      ) : mockups.isError ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <ShellInlineFault
            message={errorText(mockups.error, "The mockup author session failed to load.")}
            hint="Reload the outline to read the session."
          />
        </div>
      ) : mockups.data ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">
          Session <span className="font-mono text-xs">{status.sessionId}</span> is not on this
          outline.
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ShellLoadingState label="Loading mockup author" />
        </div>
      )}
    </div>
  );
}
