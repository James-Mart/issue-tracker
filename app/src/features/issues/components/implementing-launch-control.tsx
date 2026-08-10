import type { ConversationChannel } from "@server/schemas";
import { ShellState } from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import { useAgentModelsQuery } from "@/features/agents/api/queries";
import { Link } from "react-router-dom";
import { useCreateChannelSession } from "../api/mutations";
import { useConfirmChannelLiveRun } from "../hooks/use-confirm-channel-live-run";
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
  onStarted,
  onLockRefusal,
}: {
  issue: ImplementingWorkRoot;
  channel: ConversationChannel;
  variant: "primary" | "secondary";
  onStarted: (session: ImplementingSessionStarted) => void;
  onLockRefusal: (refusal: ImplementingLockRefusal) => void;
}) {
  const { data: modelsData, isLoading: modelsLoading } = useAgentModelsQuery();
  const models = modelsData?.models ?? [];
  const createSession = useCreateChannelSession(issue.id, channel, {
    suppressToast: (err) => parseImplementingLockRefusal(err) !== undefined,
  });
  const {
    confirmIfLiveRun,
    awaitingConfirm,
    confirming,
    dialog,
  } = useConfirmChannelLiveRun(issue.id, channel);
  const copy = implementingLaunchCopy();
  const coordinatorModel = implementingSessionModel(models);
  const blocked = awaitingConfirm || confirming;
  const canStart =
    Boolean(coordinatorModel) &&
    !modelsLoading &&
    !createSession.isPending &&
    !blocked;

  const start = () => {
    if (!coordinatorModel || modelsLoading || createSession.isPending || blocked) {
      return;
    }
    const title = implementingSessionTitle(issue.title);
    const model = coordinatorModel;
    confirmIfLiveRun(() => {
      createSession.mutate(
        {
          title,
          model,
          message: implementingSessionMessage(issue.id),
        },
        {
          onSuccess: ({ id }) => onStarted({ id, title, model }),
          onError: (err) => {
            const refusal = parseImplementingLockRefusal(err);
            if (refusal) onLockRefusal(refusal);
          },
        },
      );
    });
  };

  const label =
    variant === "secondary" ? "New run" : copy.actionLabel;

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
