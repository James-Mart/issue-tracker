import { useEffect, useMemo, useState } from "react";
import { Loader2, Play } from "lucide-react";
import type { ConversationChannel, IssueRecord } from "@server/schemas";
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
  APPEND_TARGET_MERGED_PLANNING_BLOCKED,
  APPEND_TARGET_UNSAVED_PLANNING,
  appendPlanningCalloutVisible,
  savedAppendTargetState,
} from "../lib/append-target";
import { issuesById } from "../lib/build-tree";
import { useIssuesQuery } from "../api/queries";
import { AppendPlanningCallout } from "./append-planning-callout";
import {
  defaultConversationModel,
  planningLaunchCopy,
  planningSessionMessage,
  planningSessionModel,
  planningSessionTitle,
} from "../lib/planning-launch";
import { useAppendTargetDraftStore } from "../store/use-append-target-draft-store";
import { useCockpitLaunchStore } from "../store/use-cockpit-launch-store";
import { StakeholderSelect } from "./stakeholder-select";

type IdeaRecord = Extract<IssueRecord, { kind: "idea" }>;

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

function useIdeaGateToggle(
  issue: IdeaRecord,
  field: "outlineGate" | "executionGate",
) {
  const stored = issue[field] === true;
  const [enabled, setEnabled] = useState(stored);
  const update = useUpdateIssue();
  const { saving, run } = useIssuePatchAction();

  useEffect(() => {
    setEnabled(issue[field] === true);
  }, [issue, field]);

  const onToggle = () => {
    const next = !enabled;
    const previous = enabled;
    setEnabled(next);
    void run(async () => {
      try {
        await update.mutateAsync({
          id: issue.id,
          patch: { [field]: next },
        });
      } catch (err) {
        setEnabled(previous);
        throw err;
      }
    });
  };

  return { enabled, onToggle, saving };
}

function IdeaGateChipButton({
  issue,
  field,
  label,
  enabled,
  onToggle,
  saving,
  testId,
}: {
  issue: IdeaRecord;
  field: "outlineGate" | "executionGate";
  label: string;
  enabled: boolean;
  onToggle: () => void;
  saving: boolean;
  testId: string;
}) {
  const stateLabel = enabled ? "on" : "off";
  const controlId =
    field === "outlineGate"
      ? `outline-gate-${issue.id}`
      : `execution-gate-${issue.id}`;

  return (
    <Button
      type="button"
      variant="default"
      id={controlId}
      aria-pressed={enabled}
      data-testid={testId}
      disabled={saving}
      className="h-7 px-2 font-mono text-[10px] tracking-[0.08em]"
      onClick={onToggle}
    >
      <span className="text-muted-foreground">{label} ·</span>{" "}
      <span
        className={cn(
          enabled
            ? "text-[hsl(var(--current))]"
            : "text-muted-foreground",
        )}
      >
        {stateLabel}
      </span>
    </Button>
  );
}

function OutlineGateChip({
  issue,
  testId = "flow-row-outline-gate",
}: {
  issue: IdeaRecord;
  testId?: string;
}) {
  const control = useIdeaGateToggle(issue, "outlineGate");
  return (
    <IdeaGateChipButton
      issue={issue}
      field="outlineGate"
      label="Outline gate"
      testId={testId}
      enabled={control.enabled}
      onToggle={control.onToggle}
      saving={control.saving}
    />
  );
}

function ExecutionGateChip({
  issue,
  testId = "flow-row-execution-gate",
}: {
  issue: IdeaRecord;
  testId?: string;
}) {
  const control = useIdeaGateToggle(issue, "executionGate");
  return (
    <IdeaGateChipButton
      issue={issue}
      field="executionGate"
      label="Execution gate"
      testId={testId}
      enabled={control.enabled}
      onToggle={control.onToggle}
      saving={control.saving}
    />
  );
}

function IdeaGateChips({
  issue,
  testIdPrefix,
}: {
  issue: IdeaRecord;
  testIdPrefix: "flow-row" | "detail";
}) {
  return (
    <>
      <OutlineGateChip issue={issue} testId={`${testIdPrefix}-outline-gate`} />
      <ExecutionGateChip
        issue={issue}
        testId={`${testIdPrefix}-execution-gate`}
      />
    </>
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
  issue: IdeaRecord;
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

/** Gate toggles for a captured Idea row. Empty without a stakeholder. */
export function PlanningFlowRowGates({ issue }: { issue: IdeaRecord }) {
  if (!issue.stakeholder) return null;
  return <IdeaGateChips issue={issue} testIdPrefix="flow-row" />;
}

/** Icon-only planning launch for Flow row steering. */
export function PlanningFlowRowLaunch({
  issue,
  gates = true,
}: {
  issue: IdeaRecord;
  /** Row layout places gates outside the icon slot. */
  gates?: boolean;
}) {
  const stakeholder = issue.stakeholder;

  return (
    <div className="flex items-center gap-1">
      {gates ? <PlanningFlowRowGates issue={issue} /> : null}
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
export function PlanningOverviewLaunch({ issue }: { issue: IdeaRecord }) {
  const stakeholder = issue.stakeholder;
  const rejectedUnsaved = useAppendTargetDraftStore(
    (s) => s.rejectedById[issue.id] === true,
  );
  const { data } = useIssuesQuery();
  const byId = useMemo(() => issuesById(data?.issues ?? []), [data?.issues]);
  const derived = data?.derived?.[issue.id];
  const appendTarget = savedAppendTargetState(issue.appendTo, issue.partOf, byId);
  const planningBlocked = appendTarget.kind === "merged";
  const showAppendCallout =
    appendTarget.kind === "valid" &&
    appendPlanningCalloutVisible(issue.appendTo, derived);

  return (
    <div className="flex flex-col gap-2">
      {showAppendCallout ? (
        <AppendPlanningCallout storyTitle={appendTarget.storyTitle} />
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {stakeholder ? (
          <IdeaGateChips issue={issue} testIdPrefix="detail" />
        ) : null}
        <PlanningLaunchButton
          issue={issue}
          channel="planning"
          stakeholder={stakeholder}
          variant="primary"
          optimistic
          disabled={planningBlocked}
          testId="planning-overview-start-session"
          onStarted={() => {}}
        />
      </div>
      {rejectedUnsaved ? (
        <p
          data-testid="planning-append-target-unsaved"
          className="text-sm text-muted-foreground"
        >
          {APPEND_TARGET_UNSAVED_PLANNING}
        </p>
      ) : null}
      {planningBlocked ? (
        <p
          data-testid="planning-append-target-merged-blocked"
          className="text-sm text-muted-foreground"
        >
          {APPEND_TARGET_MERGED_PLANNING_BLOCKED}
        </p>
      ) : null}
    </div>
  );
}

/** Empty-state launch: stakeholder picker beside the primary start action. */
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
  const outlineGateControl = useIdeaGateToggle(issue, "outlineGate");
  const [selectedCatalogId, setSelectedCatalogId] = useState<string | undefined>();
  const copy = planningLaunchCopy(
    stakeholder,
    models,
    outlineGateControl.enabled,
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
            <>
              <IdeaGateChipButton
                issue={issue}
                field="outlineGate"
                label="Outline gate"
                testId="detail-outline-gate"
                enabled={outlineGateControl.enabled}
                onToggle={outlineGateControl.onToggle}
                saving={outlineGateControl.saving}
              />
              <ExecutionGateChip
                issue={issue}
                testId="detail-execution-gate"
              />
            </>
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
  issue: IdeaRecord;
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
