import { Loader2, Play } from "lucide-react";
import type { ConversationChannel, IssueKind } from "@server/schemas";
import { ShellState } from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import { useAgentModelsQuery } from "@/features/agents/api/queries";
import { useSendConversationMessage } from "@/features/agents/api/mutations";
import { useMemo } from "react";
import { ApiError } from "@/lib/api/errors";
import { useCreateChannelSession } from "../api/mutations";
import { useChannelSessionsQuery, useIssuesQuery } from "../api/queries";
import { currentChannelSession } from "../api/channel-sessions";
import { useConfirmChannelLiveRun } from "../hooks/use-confirm-channel-live-run";
import { useCockpitLaunchStore } from "../store/use-cockpit-launch-store";
import {
  implementingLaunchCopy,
  implementingResumePrompt,
  implementingSessionMessage,
  implementingSessionModel,
  implementingSessionTitle,
  isImplementingWorkRoot,
  type ImplementingWorkRoot,
} from "../lib/implementing-launch";
import { overviewWorkLoopAction } from "../lib/overview-work-loop-action";
import { issuesById } from "../lib/build-tree";
import { leafTasksOf } from "../lib/derived";
import { WorkLoopOverviewControl } from "./work-loop-overview-control";

export type ImplementingSessionStarted = {
  id: string;
  title: string;
  model: string;
};

function implementingLockHolderTitle(err: unknown): string | undefined {
  if (!(err instanceof ApiError) || err.status !== 409) return undefined;
  const body = err.body;
  if (!body || typeof body !== "object") return undefined;
  const holderIssueTitle = (body as Record<string, unknown>).holderIssueTitle;
  return typeof holderIssueTitle === "string" ? holderIssueTitle : undefined;
}

function isImplementingLockConflict(err: unknown): boolean {
  return implementingLockHolderTitle(err) !== undefined;
}

function ImplementingLaunchButton({
  issue,
  channel,
  variant,
  optimistic,
  testId,
  onStarted,
}: {
  issue: ImplementingWorkRoot;
  channel: ConversationChannel;
  variant: "primary" | "secondary" | "icon";
  optimistic?: boolean;
  testId?: string;
  onStarted: (session: ImplementingSessionStarted) => void;
}) {
  const { data: modelsData, isLoading: modelsLoading } = useAgentModelsQuery();
  const models = modelsData?.models ?? [];
  const createSession = useCreateChannelSession(issue.id, channel, {
    suppressToast: (err) =>
      Boolean(optimistic) || isImplementingLockConflict(err),
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
            if (optimistic) {
              ackLaunch(issue.id, "work", { id, title, model });
            }
            onStarted({ id, title, model });
          },
          onError: (err) => {
            const lockHolderTitle = implementingLockHolderTitle(err);
            if (optimistic) {
              failLaunch(issue.id, "work", {
                lockHolderTitle,
                status: lockHolderTitle ? 409 : undefined,
                errorMessage: err instanceof Error ? err.message : undefined,
              });
            }
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
          testId ??
          (variant === "secondary"
            ? "implementing-new-run"
            : "implementing-start-session")
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
}: {
  issue: ImplementingWorkRoot;
}) {
  return (
    <ImplementingLaunchButton
      issue={issue}
      channel="implementing"
      variant="icon"
      optimistic
      onStarted={() => {}}
    />
  );
}

/** Post-rail Overview control: start or resume the work loop from Overview. */
export function ImplementingOverviewLaunch({
  issue,
  parentKind,
}: {
  issue: ImplementingWorkRoot;
  parentKind?: IssueKind;
}) {
  const { data: list } = useIssuesQuery();
  const { data: sessions, isLoading: sessionsLoading } = useChannelSessionsQuery(
    issue.id,
    "implementing",
  );
  const { data: modelsData, isLoading: modelsLoading } = useAgentModelsQuery();
  const models = modelsData?.models ?? [];
  const createSession = useCreateChannelSession(issue.id, "implementing", {
    suppressToast: (err) => isImplementingLockConflict(err),
  });
  const sendMessage = useSendConversationMessage();
  const beginLaunch = useCockpitLaunchStore((s) => s.beginLaunch);
  const ackLaunch = useCockpitLaunchStore((s) => s.ackLaunch);
  const failLaunch = useCockpitLaunchStore((s) => s.failLaunch);
  const pending = useCockpitLaunchStore((s) => s.pending);
  const launching = pending?.issueId === issue.id;

  const workLoopAction = useMemo(() => {
    if (!isImplementingWorkRoot("implementing", issue, parentKind)) {
      return { action: "hidden" as const };
    }
    const issues = list?.issues ?? [];
    const byId = issuesById(issues);
    const record = byId.get(issue.id);
    if (!record) return { action: "hidden" as const };
    const liveRun = list?.derived?.[issue.id]?.liveRun ?? false;
    const currentSession = currentChannelSession(sessions ?? []);
    return overviewWorkLoopAction({
      liveRun,
      leafTasks: leafTasksOf(record, issues),
      currentSession,
    });
  }, [issue, parentKind, list?.issues, list?.derived, sessions]);

  if (
    sessionsLoading ||
    workLoopAction.action === "hidden"
  ) {
    return null;
  }

  const coordinatorModel = implementingSessionModel(models);
  const startPending =
    workLoopAction.action === "start" &&
    (createSession.isPending || launching);
  const resumePending =
    workLoopAction.action === "resume" &&
    (sendMessage.isPending || launching);

  const startWorkLoop = () => {
    if (
      !coordinatorModel ||
      modelsLoading ||
      createSession.isPending ||
      launching
    ) {
      return;
    }
    const title = implementingSessionTitle(issue.title);
    const model = coordinatorModel;
    beginLaunch(issue.id, "work");
    createSession.mutate(
      {
        title,
        model,
        message: implementingSessionMessage(issue.id),
      },
      {
        onSuccess: ({ id }) => {
          ackLaunch(issue.id, "work", { id, title, model });
        },
        onError: (err) => {
          const lockHolderTitle = implementingLockHolderTitle(err);
          failLaunch(issue.id, "work", {
            lockHolderTitle,
            status: lockHolderTitle
              ? 409
              : err instanceof ApiError
                ? err.status
                : undefined,
            errorMessage: err instanceof Error ? err.message : undefined,
          });
        },
      },
    );
  };

  const resumeWorkLoop = () => {
    if (
      workLoopAction.action !== "resume" ||
      sendMessage.isPending ||
      launching
    ) {
      return;
    }
    const { resumeSession } = workLoopAction;
    beginLaunch(issue.id, "work");
    sendMessage.mutate(
      {
        id: resumeSession.id,
        body: { prompt: implementingResumePrompt() },
      },
      {
        onSuccess: () => {
          ackLaunch(issue.id, "work", {
            id: resumeSession.id,
            title: resumeSession.title,
            model: resumeSession.model,
          });
        },
        onError: (err) => {
          failLaunch(issue.id, "work", {
            status: err instanceof ApiError ? err.status : undefined,
            errorMessage: err instanceof Error ? err.message : undefined,
          });
        },
      },
    );
  };

  if (workLoopAction.action === "start") {
    return (
      <WorkLoopOverviewControl
        mode="start"
        actionTestId="implementing-overview-start-session"
        disabled={!coordinatorModel || modelsLoading || startPending}
        pending={startPending}
        onAction={startWorkLoop}
      />
    );
  }

  return (
    <WorkLoopOverviewControl
      mode="resume"
      session={workLoopAction.resumeSession}
      actionTestId="implementing-overview-resume-session"
      disabled={resumePending}
      pending={resumePending}
      onAction={resumeWorkLoop}
    />
  );
}

/** Empty-state launch for an Epic or project-level Story. */
export function ImplementingChannelEmptyState({
  issue,
  channel,
  onStarted,
}: {
  issue: ImplementingWorkRoot;
  channel: ConversationChannel;
  onStarted: (session: ImplementingSessionStarted) => void;
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
          optimistic
          onStarted={onStarted}
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
}: {
  issue: ImplementingWorkRoot;
  channel: ConversationChannel;
  onStarted: (session: ImplementingSessionStarted) => void;
}) {
  return (
    <ImplementingLaunchButton
      issue={issue}
      channel={channel}
      variant="secondary"
      onStarted={onStarted}
    />
  );
}
