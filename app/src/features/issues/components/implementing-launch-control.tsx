import { Loader2, Play } from "lucide-react";
import type { ConversationChannel } from "@server/schemas";
import { ShellState } from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import { useAgentModelsQuery } from "@/features/agents/api/queries";
import { Link, useLocation } from "react-router-dom";
import { useCreateChannelSession } from "../api/mutations";
import { useConfirmChannelLiveRun } from "../hooks/use-confirm-channel-live-run";
import { useCockpitLaunchStore } from "../store/use-cockpit-launch-store";
import {
  type IssueBackLocationState,
  issueBackNavigateState,
} from "../lib/issue-back";
import {
  implementingLaunchCopy,
  implementingLockRefusalCopy,
  implementingSessionMessage,
  implementingSessionModel,
  implementingSessionTitle,
  parseImplementingLockRefusal,
  type ImplementingLockRefusal,
  type ImplementingWorkRoot,
} from "../lib/implementing-launch";
import { issueChannelPath } from "../lib/links";

export type ImplementingSessionStarted = {
  id: string;
  title: string;
  model: string;
};

export function ImplementingLockRefusalState({
  projectId,
  refusal,
}: {
  projectId: string;
  refusal: ImplementingLockRefusal;
}) {
  const location = useLocation();
  const linkState = issueBackNavigateState(
    location.pathname,
    location.search,
    (location.state as IssueBackLocationState | null)?.issueBackStack,
  );
  const copy = implementingLockRefusalCopy(refusal.holderIssueTitle);
  return (
    <ShellState
      className="border-0 bg-transparent px-4 py-8 shadow-none"
      tone="blocked"
      eyebrow="Implementing"
      title={copy.title}
      detail={
        <>
          {copy.detailPrefix}{" "}
          <Link
            to={issueChannelPath(
              projectId,
              refusal.holderIssueId,
              "implementing",
            )}
            state={linkState}
            className="font-medium text-foreground underline underline-offset-2 hover:text-[hsl(var(--current))]"
            data-testid="implementing-lock-holder-link"
          >
            Implementing channel
          </Link>
          .
        </>
      }
    />
  );
}

function ImplementingLaunchButton({
  issue,
  channel,
  variant,
  optimistic,
  onStarted,
  onLockRefusal,
}: {
  issue: ImplementingWorkRoot;
  channel: ConversationChannel;
  variant: "primary" | "secondary" | "icon";
  optimistic?: boolean;
  onStarted: (session: ImplementingSessionStarted) => void;
  onLockRefusal: (refusal: ImplementingLockRefusal) => void;
}) {
  const { data: modelsData, isLoading: modelsLoading } = useAgentModelsQuery();
  const models = modelsData?.models ?? [];
  const createSession = useCreateChannelSession(issue.id, channel, {
    suppressToast: (err) =>
      Boolean(optimistic) || parseImplementingLockRefusal(err) !== undefined,
  });
  const {
    confirmIfLiveRun,
    awaitingConfirm,
    confirming,
    dialog,
  } = useConfirmChannelLiveRun(issue.id, channel);
  const beginLaunch = useCockpitLaunchStore((s) => s.beginLaunch);
  const ackLaunch = useCockpitLaunchStore((s) => s.ackLaunch);
  const failLaunch = useCockpitLaunchStore((s) => s.failLaunch);
  const pending = useCockpitLaunchStore((s) => s.pending);
  const launching = Boolean(optimistic) && pending?.issueId === issue.id;
  const copy = implementingLaunchCopy();
  const coordinatorModel = implementingSessionModel(models);
  const blocked = awaitingConfirm || confirming;
  const canStart =
    Boolean(coordinatorModel) &&
    !modelsLoading &&
    !createSession.isPending &&
    !blocked &&
    !launching;

  const start = () => {
    if (
      !coordinatorModel ||
      modelsLoading ||
      createSession.isPending ||
      blocked ||
      launching
    ) {
      return;
    }
    const title = implementingSessionTitle(issue.title);
    const model = coordinatorModel;
    confirmIfLiveRun(() => {
      if (optimistic) beginLaunch(issue.id, "work");
      createSession.mutate(
        {
          title,
          model,
          message: implementingSessionMessage(issue.id),
        },
        {
          onSuccess: ({ id }) => {
            if (optimistic) ackLaunch(issue.id, "work");
            onStarted({ id, title, model });
          },
          onError: (err) => {
            const refusal = parseImplementingLockRefusal(err);
            if (optimistic) {
              failLaunch(issue.id, "work", { lockRefusal: Boolean(refusal) });
            }
            if (refusal) onLockRefusal(refusal);
          },
        },
      );
    });
  };

  const label =
    variant === "secondary" ? "New run" : copy.actionLabel;

  if (variant === "icon") {
    if (modelsLoading || !coordinatorModel) return null;

    return (
      <>
        <Button
          type="button"
          variant="default"
          size="icon-sm"
          title={launching ? "Starting work" : "Start work"}
          aria-label={launching ? "Starting work" : "Start work"}
          aria-busy={launching || undefined}
          data-testid={
            launching ? "flow-row-launch-pending" : "flow-row-start-work"
          }
          disabled={launching}
          onClick={start}
        >
          {launching ? (
            <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
        </Button>
        {dialog}
      </>
    );
  }

  return (
    <>
      <Button
        type="button"
        variant={variant === "primary" ? "primary" : "secondary"}
        size="sm"
        disabled={!canStart}
        data-testid={
          variant === "secondary"
            ? "implementing-new-run"
            : "implementing-start-session"
        }
        onClick={start}
      >
        {createSession.isPending ? "Starting…" : label}
      </Button>
      {dialog}
    </>
  );
}

/** Icon-only implementing launch for Flow row steering. */
export function ImplementingFlowRowLaunch({
  issue,
  onLockRefusal,
}: {
  issue: ImplementingWorkRoot;
  onLockRefusal: (refusal: ImplementingLockRefusal) => void;
}) {
  return (
    <ImplementingLaunchButton
      issue={issue}
      channel="implementing"
      variant="icon"
      optimistic
      onStarted={() => {}}
      onLockRefusal={onLockRefusal}
    />
  );
}

/** Empty-state launch for an Epic or project-level Story. */
export function ImplementingChannelEmptyState({
  issue,
  channel,
  onStarted,
  onLockRefusal,
}: {
  issue: ImplementingWorkRoot;
  channel: ConversationChannel;
  onStarted: (session: ImplementingSessionStarted) => void;
  onLockRefusal: (refusal: ImplementingLockRefusal) => void;
}) {
  const copy = implementingLaunchCopy();

  return (
    <ShellState
      className="border-0 bg-transparent px-4 py-8 shadow-none"
      eyebrow="Implementing"
      title={copy.title}
      detail={copy.detail}
      action={
        <ImplementingLaunchButton
          issue={issue}
          channel={channel}
          variant="primary"
          onStarted={onStarted}
          onLockRefusal={onLockRefusal}
        />
      }
    />
  );
}

/** Secondary header action once an implementing session exists. */
export function ImplementingNewRunControl({
  issue,
  channel,
  onStarted,
  onLockRefusal,
}: {
  issue: ImplementingWorkRoot;
  channel: ConversationChannel;
  onStarted: (session: ImplementingSessionStarted) => void;
  onLockRefusal: (refusal: ImplementingLockRefusal) => void;
}) {
  return (
    <ImplementingLaunchButton
      issue={issue}
      channel={channel}
      variant="secondary"
      onStarted={onStarted}
      onLockRefusal={onLockRefusal}
    />
  );
}
