import { useEffect, useState } from "react";
import type { ConversationChannel, IssueDetail } from "@server/schemas";
import { ShellState } from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import { useAgentModelsQuery } from "@/features/agents/api/queries";
import {
  useCreateChannelSession,
  useUpdateIssue,
} from "../api/mutations";
import { useConfirmChannelLiveRun } from "../hooks/use-confirm-channel-live-run";
import { useIssuePatchAction } from "../hooks/use-issue-patch-action";
import {
  defaultConversationModel,
  planningLaunchCopy,
  planningSessionMessage,
  planningSessionModel,
  planningSessionTitle,
} from "../lib/planning-launch";
import { StakeholderSelect } from "./stakeholder-select";

type IdeaDetail = Extract<IssueDetail, { kind: "idea" }>;

function usePlanningStakeholder(issue: IdeaDetail) {
  const [stakeholder, setStakeholder] = useState(issue.stakeholder);
  const update = useUpdateIssue();
  const { error, saving, run } = useIssuePatchAction();

  useEffect(() => {
    setStakeholder(issue.stakeholder);
  }, [issue.stakeholder]);

  const onChange = (value: string | null) => {
    const next = value ?? undefined;
    const previous = issue.stakeholder;
    setStakeholder(next);
    if (next === previous || (next === undefined && previous === undefined)) {
      return;
    }
    void run(async () => {
      try {
        await update.mutateAsync({
          id: issue.id,
          patch: { stakeholder: value },
        });
      } catch (err) {
        setStakeholder(previous);
        throw err;
      }
    });
  };

  return { stakeholder, onChange, saving, error };
}

export type PlanningSessionStarted = {
  id: string;
  title: string;
  model: string;
};

function PlanningLaunchButton({
  issue,
  channel,
  stakeholder,
  variant,
  disabled,
  onStarted,
}: {
  issue: IdeaDetail;
  channel: ConversationChannel;
  stakeholder: string | undefined;
  variant: "primary" | "secondary";
  disabled?: boolean;
  onStarted: (session: PlanningSessionStarted) => void;
}) {
  const { data: modelsData, isLoading: modelsLoading } = useAgentModelsQuery();
  const models = modelsData?.models ?? [];
  const createSession = useCreateChannelSession(issue.id, channel);
  const {
    confirmIfLiveRun,
    awaitingConfirm,
    confirming,
    dialog,
  } = useConfirmChannelLiveRun(issue.id, channel);
  const copy = planningLaunchCopy(stakeholder, models);
  const defaultModel = defaultConversationModel(models);
  const blocked = awaitingConfirm || confirming;
  const canStart =
    Boolean(defaultModel) &&
    !modelsLoading &&
    !createSession.isPending &&
    !blocked &&
    !disabled;

  const start = () => {
    if (!defaultModel || modelsLoading || createSession.isPending || blocked) {
      return;
    }
    if (disabled) return;
    const title = planningSessionTitle(issue.title);
    const model = planningSessionModel(stakeholder, defaultModel);
    confirmIfLiveRun(() => {
      createSession.mutate(
        {
          title,
          model,
          message: planningSessionMessage(issue.id, stakeholder),
        },
        {
          onSuccess: ({ id }) => onStarted({ id, title, model }),
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
            ? "planning-new-run"
            : "planning-start-session"
        }
        onClick={start}
      >
        {createSession.isPending ? "Starting…" : label}
      </Button>
      {dialog}
    </>
  );
}

/** Empty-state launch: stakeholder picker beside the primary start action. */
export function PlanningChannelEmptyState({
  issue,
  channel,
  onStarted,
}: {
  issue: IdeaDetail;
  channel: ConversationChannel;
  onStarted: (session: PlanningSessionStarted) => void;
}) {
  const { data: modelsData, isLoading: modelsLoading } = useAgentModelsQuery();
  const models = modelsData?.models ?? [];
  const { stakeholder, onChange, saving, error } = usePlanningStakeholder(issue);
  const copy = planningLaunchCopy(stakeholder, models);

  return (
    <ShellState
      className="border-0 bg-transparent px-4 py-8 shadow-none"
      eyebrow="Planning"
      title={copy.title}
      detail={
        <>
          {copy.detail}
          {error ? (
            <p className="mt-2 text-sm text-destructive">{error}</p>
          ) : null}
        </>
      }
      action={
        <div className="flex flex-wrap items-center justify-center gap-2">
          <StakeholderSelect
            id="planning-stakeholder"
            value={stakeholder}
            models={models}
            loading={modelsLoading}
            disabled={saving}
            onChange={onChange}
          />
          <PlanningLaunchButton
            issue={issue}
            channel={channel}
            stakeholder={stakeholder}
            variant="primary"
            disabled={saving}
            onStarted={onStarted}
          />
        </div>
      }
    />
  );
}

/** Secondary header action once a planning session exists. */
export function PlanningNewRunControl({
  issue,
  channel,
  onStarted,
}: {
  issue: IdeaDetail;
  channel: ConversationChannel;
  onStarted: (session: PlanningSessionStarted) => void;
}) {
  const { stakeholder } = usePlanningStakeholder(issue);

  return (
    <PlanningLaunchButton
      issue={issue}
      channel={channel}
      stakeholder={stakeholder}
      variant="secondary"
      onStarted={onStarted}
    />
  );
}
