import { useEffect, useMemo, useState } from "react";
import { Loader2, Play } from "lucide-react";
import { FIELD_LABELS } from "@server/fields";
import type { ConversationChannel, IssueRecord } from "@server/schemas";
import { ShellState } from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { issuesById } from "../lib/build-tree";
import { useIssuesQuery } from "../api/queries";
import { IdeaExecutionGateEffectLine } from "./idea-execution-gate-effect-line";
import {
  IdeaPlanSettings,
  IdeaPlanSettingsControls,
  useIdeaPlanSettings,
} from "./idea-plan-settings";
import {
  defaultConversationModel,
  planningLaunchCopy,
  planningSessionMessage,
  planningSessionModel,
  planningSessionTitle,
} from "../lib/planning-launch";
import { useCockpitLaunchStore } from "../store/use-cockpit-launch-store";
import { StakeholderSelect } from "./stakeholder-select";

type IdeaRecord = Extract<IssueRecord, { kind: "idea" }>;

function useIssuesById() {
  const { data } = useIssuesQuery();
  const byId = useMemo(() => issuesById(data?.issues ?? []), [data?.issues]);
  return { data, byId };
}

function usePlanningMergeBase(issue: IdeaRecord) {
  const { byId } = useIssuesById();
  const project = byId.get(issue.partOf);
  const trunk = project?.kind === "project" ? project.trunk : undefined;
  const defaultMergeBase = issue.mergeBase ?? trunk ?? "";
  const [override, setOverride] = useState<string | null>(null);
  const mergeBase = override ?? defaultMergeBase;
  const update = useUpdateIssue();

  const writeMergeBase = async () => {
    if (mergeBase === issue.mergeBase) return;
    await update.mutateAsync({
      id: issue.id,
      patch: { mergeBase },
    });
  };

  return {
    mergeBase,
    onChange: setOverride,
    writeMergeBase,
    pending: update.isPending,
  };
}

function PlanningMergeBaseControl({
  issueId,
  value,
  onChange,
  disabled,
}: {
  issueId: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        id={`planning-merge-base-${issueId}`}
        aria-label={FIELD_LABELS.mergeBase}
        data-testid="planning-merge-base"
        value={value}
        disabled={disabled}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onChange={(event) => onChange(event.target.value)}
        className="h-7 w-44 px-2 font-mono text-[13px] tabular-nums"
      />
      <p className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        {FIELD_LABELS.mergeBase}
      </p>
    </div>
  );
}

function usePlanningStakeholder(issue: IdeaRecord) {
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
  optimistic,
  testId,
  beforeStart,
  onStarted,
}: {
  issue: IdeaRecord;
  channel: ConversationChannel;
  stakeholder: string | undefined;
  fallbackCatalogId?: string;
  variant: "primary" | "secondary" | "icon";
  disabled?: boolean;
  optimistic?: boolean;
  testId?: string;
  /** Runs after live-run confirmation and before the session is created. */
  beforeStart?: () => Promise<void>;
  onStarted: (session: PlanningSessionStarted) => void;
}) {
  const { data: modelsData, isLoading: modelsLoading } = useAgentModelsQuery();
  const models = modelsData?.models ?? [];
  const failLaunch = useCockpitLaunchStore((s) => s.failLaunch);
  const createSession = useCreateChannelSession(issue.id, channel, {
    suppressToast: optimistic ? () => true : undefined,
    onError: (err) => {
      if (!optimistic) return;
      failLaunch(issue.id, "planning", { errorMessage: err.message });
    },
  });
  const {
    confirmIfLiveRun,
    awaitingConfirm,
    confirming,
    dialog,
  } = useConfirmChannelLiveRun(issue.id, channel);
  const beginLaunch = useCockpitLaunchStore((s) => s.beginLaunch);
  const ackLaunch = useCockpitLaunchStore((s) => s.ackLaunch);
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
    confirmIfLiveRun(async () => {
      try {
        if (beforeStart) await beforeStart();
      } catch {
        return;
      }
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
          disabled={launching || disabled}
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
export function PlanningFlowRowLaunch({ issue }: { issue: IdeaRecord }) {
  return (
    <PlanningLaunchButton
      issue={issue}
      channel="planning"
      stakeholder={issue.stakeholder}
      variant="icon"
      optimistic
      onStarted={() => {}}
    />
  );
}

/** Overview plan settings, plus the start control when planning has not begun. */
export function PlanningOverviewLaunch({
  issue,
  showLaunch = true,
}: {
  issue: IdeaRecord;
  showLaunch?: boolean;
}) {
  return (
    <div className={showLaunch ? "flex flex-col gap-2" : undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <IdeaPlanSettings issue={issue} testIdPrefix="detail" />
        {showLaunch ? (
          <PlanningLaunchButton
            issue={issue}
            channel="planning"
            stakeholder={issue.stakeholder}
            variant="primary"
            optimistic
            testId="planning-overview-start-session"
            onStarted={() => {}}
          />
        ) : null}
      </div>
    </div>
  );
}

/** Empty-state launch on the planning tab: stakeholder, merge base, and gates. */
export function PlanningChannelEmptyState({
  issue,
  channel,
  onStarted,
}: {
  issue: IdeaRecord;
  channel: ConversationChannel;
  onStarted: (session: PlanningSessionStarted) => void;
}) {
  const { data: modelsData, isLoading: modelsLoading } = useAgentModelsQuery();
  const models = modelsData?.models ?? [];
  const defaultModel = defaultConversationModel(models);
  const { stakeholder, onChange, saving, error } = usePlanningStakeholder(issue);
  const mergeBaseControl = usePlanningMergeBase(issue);
  const [selectedCatalogId, setSelectedCatalogId] = useState<string | undefined>();
  const planSettings = useIdeaPlanSettings(issue);
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
        <div className="flex w-full max-w-md flex-col items-center gap-3">
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
            <PlanningMergeBaseControl
              issueId={issue.id}
              value={mergeBaseControl.mergeBase}
              disabled={saving}
              onChange={mergeBaseControl.onChange}
            />
            <IdeaPlanSettingsControls
              issue={issue}
              testIdPrefix="detail"
              settings={planSettings}
            />
            <PlanningLaunchButton
              issue={issue}
              channel={channel}
              stakeholder={stakeholder}
              fallbackCatalogId={stakeholder ? undefined : selectedCatalogId}
              variant="primary"
              optimistic
              disabled={
                saving ||
                mergeBaseControl.pending ||
                !mergeBaseControl.mergeBase.trim()
              }
              beforeStart={mergeBaseControl.writeMergeBase}
              onStarted={onStarted}
            />
          </div>
          <IdeaExecutionGateEffectLine
            settings={planSettings}
            className="w-full px-2"
          />
        </div>
      }
    />
  );
}

/** Gate row, execution effect, and New run once a planning session exists. */
export function PlanningNewRunControl({
  issue,
  channel,
  onStarted,
}: {
  issue: IdeaRecord;
  channel: ConversationChannel;
  onStarted: (session: PlanningSessionStarted) => void;
}) {
  const { data: modelsData, isLoading: modelsLoading } = useAgentModelsQuery();
  const models = modelsData?.models ?? [];
  const defaultModel = defaultConversationModel(models);
  const { stakeholder } = usePlanningStakeholder(issue);
  const planSettings = useIdeaPlanSettings(issue);
  const [selectedCatalogId, setSelectedCatalogId] = useState<string | undefined>();

  useEffect(() => {
    if (defaultModel && selectedCatalogId === undefined) {
      setSelectedCatalogId(defaultModel);
    }
  }, [defaultModel, selectedCatalogId]);

  return (
    <div
      className="flex min-w-0 flex-col items-stretch gap-2 sm:items-end"
      data-testid="planning-idea-session-chrome"
    >
      <div className="flex flex-wrap items-center justify-end gap-2">
        <IdeaPlanSettingsControls
          issue={issue}
          testIdPrefix="detail"
          settings={planSettings}
        />
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
          optimistic
          onStarted={onStarted}
        />
      </div>
      <IdeaExecutionGateEffectLine
        settings={planSettings}
        className="sm:text-right"
      />
    </div>
  );
}
