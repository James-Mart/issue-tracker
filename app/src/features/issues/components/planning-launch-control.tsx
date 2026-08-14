import { useEffect, useState } from "react";
import type { ConversationChannel, IssueDetail } from "@server/schemas";
import { ShellState } from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AgentModel } from "@/features/agents/api/client";
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

/** Planner model catalog picker for human-driven planning launch. */
export function PlanningSessionModelSelect({
  value,
  models,
  disabled,
  loading,
  onChange,
}: {
  value: string | undefined;
  models: readonly AgentModel[];
  disabled?: boolean;
  loading?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Select
        value={value ?? ""}
        disabled={disabled || loading || models.length === 0}
        onValueChange={onChange}
      >
        <SelectTrigger
          aria-label="Planner model"
          data-testid="planning-session-model"
          className="font-mono"
        >
          <SelectValue
            placeholder={loading ? "Loading models…" : "Select a model"}
          />
        </SelectTrigger>
        <SelectContent>
          {models.map((model) => (
            <SelectItem key={model.id} value={model.id}>
              {model.displayName ?? model.id}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        Planner model
      </p>
    </div>
  );
}

function PlanningLaunchButton({
  issue,
  channel,
  stakeholder,
  fallbackCatalogId,
  variant,
  disabled,
  onStarted,
}: {
  issue: IdeaDetail;
  channel: ConversationChannel;
  stakeholder: string | undefined;
  fallbackCatalogId?: string;
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
  const catalogId = fallbackCatalogId ?? defaultModel;
  const blocked = awaitingConfirm || confirming;
  const canStart =
    Boolean(catalogId) &&
    !modelsLoading &&
    !createSession.isPending &&
    !blocked &&
    !disabled;

  const start = () => {
    if (!catalogId || modelsLoading || createSession.isPending || blocked) {
      return;
    }
    if (disabled) return;
    const title = planningSessionTitle(issue.title);
    const model = planningSessionModel(
      stakeholder,
      fallbackCatalogId ?? defaultModel!,
    );
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
  const defaultModel = defaultConversationModel(models);
  const { stakeholder, onChange, saving, error } = usePlanningStakeholder(issue);
  const [selectedCatalogId, setSelectedCatalogId] = useState<string | undefined>();
  const copy = planningLaunchCopy(stakeholder, models);

  useEffect(() => {
    if (defaultModel && selectedCatalogId === undefined) {
      setSelectedCatalogId(defaultModel);
    }
  }, [defaultModel, selectedCatalogId]);

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
          {!stakeholder ? (
            <PlanningSessionModelSelect
              value={selectedCatalogId}
              models={models}
              loading={modelsLoading}
              disabled={saving}
              onChange={setSelectedCatalogId}
            />
          ) : null}
          <PlanningLaunchButton
            issue={issue}
            channel={channel}
            stakeholder={stakeholder}
            fallbackCatalogId={stakeholder ? undefined : selectedCatalogId}
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
