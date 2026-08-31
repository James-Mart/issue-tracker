import { useEffect, useState } from "react";
import { Loader2, Play } from "lucide-react";
import type { ConversationChannel, IssueDetail } from "@server/schemas";
import { ShellState } from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
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
import { useCockpitLaunchStore } from "../store/use-cockpit-launch-store";
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

function useApprovePlan(issue: IdeaDetail) {
  const [approvePlan, setApprovePlan] = useState(issue.approvePlan === true);
  const update = useUpdateIssue();
  const { saving, run } = useIssuePatchAction();

  useEffect(() => {
    setApprovePlan(issue.approvePlan === true);
  }, [issue.approvePlan]);

  const onToggle = () => {
    const next = !approvePlan;
    const previous = approvePlan;
    setApprovePlan(next);
    void run(async () => {
      try {
        await update.mutateAsync({
          id: issue.id,
          patch: { approvePlan: next },
        });
      } catch (err) {
        setApprovePlan(previous);
        throw err;
      }
    });
  };

  return { approvePlan, onToggle, saving };
}

function ApprovePlanChipButton({
  issue,
  approvePlan,
  onToggle,
  saving,
  testId = "flow-row-approve-plan",
}: {
  issue: IdeaDetail;
  approvePlan: boolean;
  onToggle: () => void;
  saving: boolean;
  testId?: string;
}) {
  const stateLabel = approvePlan ? "on" : "off";

  return (
    <Button
      type="button"
      variant="default"
      id={`approve-plan-${issue.id}`}
      aria-pressed={approvePlan}
      data-testid={testId}
      disabled={saving}
      className="h-7 px-2 font-mono text-[10px] tracking-[0.08em]"
      onClick={onToggle}
    >
      <span className="text-muted-foreground">Approve plan ·</span>{" "}
      <span
        className={cn(
          approvePlan
            ? "text-[hsl(var(--current))]"
            : "text-muted-foreground",
        )}
      >
        {stateLabel}
      </span>
    </Button>
  );
}

function ApprovePlanChip({
  issue,
  testId = "flow-row-approve-plan",
}: {
  issue: IdeaDetail;
  testId?: string;
}) {
  const control = useApprovePlan(issue);
  return (
    <ApprovePlanChipButton issue={issue} testId={testId} {...control} />
  );
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
  optimistic,
  testId,
  onStarted,
}: {
  issue: IdeaDetail;
  channel: ConversationChannel;
  stakeholder: string | undefined;
  fallbackCatalogId?: string;
  variant: "primary" | "secondary" | "icon";
  disabled?: boolean;
  optimistic?: boolean;
  testId?: string;
  onStarted: (session: PlanningSessionStarted) => void;
}) {
  const { data: modelsData, isLoading: modelsLoading } = useAgentModelsQuery();
  const models = modelsData?.models ?? [];
  const createSession = useCreateChannelSession(issue.id, channel, {
    suppressToast: optimistic ? () => true : undefined,
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
  const copy = planningLaunchCopy(stakeholder, models);
  const defaultModel = defaultConversationModel(models);
  const catalogId = fallbackCatalogId ?? defaultModel;
  const blocked = awaitingConfirm || confirming;
  const canStart =
    Boolean(catalogId) &&
    !modelsLoading &&
    !createSession.isPending &&
    !blocked &&
    !disabled &&
    !launching;

  const start = () => {
    if (
      !catalogId ||
      modelsLoading ||
      createSession.isPending ||
      blocked ||
      launching
    ) {
      return;
    }
    if (disabled) return;
    const title = planningSessionTitle(issue.title);
    const model = planningSessionModel(
      stakeholder,
      fallbackCatalogId ?? defaultModel!,
    );
    confirmIfLiveRun(() => {
      if (optimistic) beginLaunch(issue.id, "planning");
      createSession.mutate(
        {
          title,
          model,
          message: planningSessionMessage(issue.id, stakeholder),
        },
        {
          onSuccess: ({ id }) => {
            if (optimistic) {
              ackLaunch(issue.id, "planning", { id, title, model });
            }
            onStarted({ id, title, model });
          },
          onError: (err) => {
            if (optimistic) {
              failLaunch(issue.id, "planning", {
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
    if (modelsLoading || !catalogId) return null;

    return (
      <>
        <Button
          type="button"
          variant="default"
          size="icon-sm"
          title={launching ? "Starting planning" : "Begin planning"}
          aria-label={launching ? "Starting planning" : "Begin planning"}
          aria-busy={launching || undefined}
          data-testid={
            launching ? "flow-row-launch-pending" : "flow-row-start-planning"
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
            ? "planning-new-run"
            : "planning-start-session")
        }
        onClick={start}
      >
        {createSession.isPending ? "Starting…" : label}
      </Button>
      {dialog}
    </>
  );
}

/** Icon-only planning launch for Flow row steering. */
export function PlanningFlowRowLaunch({ issue }: { issue: IdeaDetail }) {
  const stakeholder = issue.stakeholder;

  return (
    <div className="flex items-center gap-1">
      {stakeholder ? <ApprovePlanChip issue={issue} /> : null}
      <PlanningLaunchButton
        issue={issue}
        channel="planning"
        stakeholder={stakeholder}
        variant="icon"
        optimistic
        onStarted={() => {}}
      />
    </div>
  );
}

/** Overview-tab launch: same optimistic start as the empty state. */
export function PlanningOverviewLaunch({ issue }: { issue: IdeaDetail }) {
  const stakeholder = issue.stakeholder;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {stakeholder ? (
        <ApprovePlanChip issue={issue} testId="detail-approve-plan" />
      ) : null}
      <PlanningLaunchButton
        issue={issue}
        channel="planning"
        stakeholder={stakeholder}
        variant="primary"
        optimistic
        testId="planning-overview-start-session"
        onStarted={() => {}}
      />
    </div>
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
  const approvePlanControl = useApprovePlan(issue);
  const [selectedCatalogId, setSelectedCatalogId] = useState<string | undefined>();
  const copy = planningLaunchCopy(
    stakeholder,
    models,
    approvePlanControl.approvePlan,
  );

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
          {stakeholder ? (
            <ApprovePlanChipButton
              issue={issue}
              testId="detail-approve-plan"
              {...approvePlanControl}
            />
          ) : null}
          <PlanningLaunchButton
            issue={issue}
            channel={channel}
            stakeholder={stakeholder}
            fallbackCatalogId={stakeholder ? undefined : selectedCatalogId}
            variant="primary"
            optimistic
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
  const { data: modelsData, isLoading: modelsLoading } = useAgentModelsQuery();
  const models = modelsData?.models ?? [];
  const defaultModel = defaultConversationModel(models);
  const { stakeholder } = usePlanningStakeholder(issue);
  const [selectedCatalogId, setSelectedCatalogId] = useState<string | undefined>();

  useEffect(() => {
    if (defaultModel && selectedCatalogId === undefined) {
      setSelectedCatalogId(defaultModel);
    }
  }, [defaultModel, selectedCatalogId]);

  return (
    <div className="flex items-center gap-2">
      {!stakeholder ? (
        <PlanningSessionModelSelect
          value={selectedCatalogId}
          models={models}
          loading={modelsLoading}
          onChange={setSelectedCatalogId}
        />
      ) : null}
      <PlanningLaunchButton
        issue={issue}
        channel={channel}
        stakeholder={stakeholder}
        fallbackCatalogId={stakeholder ? undefined : selectedCatalogId}
        variant="secondary"
        onStarted={onStarted}
      />
    </div>
  );
}
