import { useEffect, useMemo, useState } from "react";
import { Loader2, Play } from "lucide-react";
import {
  APPEND_PLANNING_CANNOT_START_MERGED,
  appendPlanningMergeBaseHint,
  appendPlanningMergeBaseLabel,
  appendPlanningResearchSentence,
} from "@server/append-planning-context";
import { CHIP_UNSET, FIELD_LABELS } from "@server/fields";
import type { ConversationChannel, IssueRecord } from "@server/schemas";
import { ShellState } from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  APPEND_TARGET_UNSAVED_PLANNING,
  appendPlanningCalloutVisible,
} from "../lib/append-target";
import { useAppendPlanningContext } from "../lib/use-append-planning-context";
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
      {issue.appendTo ? null : (
        <ExecutionGateChip
          issue={issue}
          testId={`${testIdPrefix}-execution-gate`}
        />
      )}
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
  const planning = useAppendPlanningContext(issue);

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex items-center gap-1">
        {gates ? <PlanningFlowRowGates issue={issue} /> : null}
        <PlanningLaunchButton
          issue={issue}
          channel="planning"
          stakeholder={stakeholder}
          variant="icon"
          optimistic
          disabled={planning.launchBlocked}
          onStarted={() => {}}
        />
      </div>
      {planning.refusal ? (
        <p
          data-testid="cockpit-append-planning-blocked"
          className="max-w-[16rem] text-left text-[11px] leading-snug text-muted-foreground"
        >
          {planning.refusal}
        </p>
      ) : null}
    </div>
  );
}

/** Overview-tab launch: same optimistic start as the empty state. */
export function PlanningOverviewLaunch({ issue }: { issue: IdeaRecord }) {
  const stakeholder = issue.stakeholder;
  const rejectedUnsaved = useAppendTargetDraftStore(
    (s) => s.rejectedById[issue.id] === true,
  );
  const planning = useAppendPlanningContext(issue);
  const append = planning.phase === "absent" ? undefined : planning;
  const showAppendCallout =
    append !== undefined &&
    (append.phase === "loading" || append.context.status !== "merged") &&
    appendPlanningCalloutVisible(issue.appendTo, planning.ideaDerived);

  return (
    <div className="flex flex-col gap-2">
      {showAppendCallout && append ? (
        <AppendPlanningCallout storyTitle={append.storyTitle} />
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
          disabled={planning.launchBlocked}
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
      {planning.refusal ? (
        <p
          data-testid={
            append?.phase === "ready" && append.context.status === "merged"
              ? "planning-append-target-merged-blocked"
              : "planning-append-planning-closed"
          }
          className="text-sm text-muted-foreground"
        >
          {planning.refusal}
        </p>
      ) : null}
    </div>
  );
}

function PlanningMergeBaseReadout({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        data-testid="planning-merge-base"
        className="inline-flex h-7 min-w-16 items-center justify-center rounded-md border border-border px-2 font-mono text-[13px] tabular-nums text-foreground"
      >
        {value}
      </span>
      <p className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        {FIELD_LABELS.mergeBase}
      </p>
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
  const outlineGateControl = useIdeaGateToggle(issue, "outlineGate");
  const mergeBaseControl = usePlanningMergeBase(issue);
  const planning = useAppendPlanningContext(issue);
  const [selectedCatalogId, setSelectedCatalogId] = useState<string | undefined>();
  const copy = planningLaunchCopy(
    stakeholder,
    models,
    outlineGateControl.enabled,
  );
  const append = planning.phase === "absent" ? undefined : planning;
  const ready = append?.phase === "ready" ? append : undefined;
  const research = ready
    ? appendPlanningResearchSentence(ready.context)
    : undefined;

  useEffect(() => {
    if (defaultModel && selectedCatalogId === undefined) {
      setSelectedCatalogId(defaultModel);
    }
  }, [defaultModel, selectedCatalogId]);

  const shellClass = "border-0 bg-transparent px-4 py-8 shadow-none";

  if (ready?.context.status === "merged") {
    return (
      <ShellState
        className={shellClass}
        eyebrow="Planning"
        title={copy.title}
        detail={
          <>
            <p>{APPEND_PLANNING_CANNOT_START_MERGED}</p>
            <p
              className="mt-2"
              data-testid="planning-append-target-merged-blocked"
            >
              {planning.refusal}
            </p>
          </>
        }
      />
    );
  }

  const showCallout =
    append !== undefined &&
    appendPlanningCalloutVisible(issue.appendTo, planning.ideaDerived);
  const mergeBaseValue = ready
    ? appendPlanningMergeBaseLabel(ready.context)
    : append?.phase === "loading"
      ? (append.mergeBase ?? CHIP_UNSET)
      : CHIP_UNSET;
  const mergeBaseHint = ready
    ? appendPlanningMergeBaseHint(ready.context)
    : undefined;
  const launchButton = (
    disabled: boolean,
    beforeStart?: () => Promise<void>,
  ) => (
    <PlanningLaunchButton
      issue={issue}
      channel={channel}
      stakeholder={stakeholder}
      fallbackCatalogId={stakeholder ? undefined : selectedCatalogId}
      variant="primary"
      optimistic
      disabled={disabled}
      beforeStart={beforeStart}
      onStarted={onStarted}
    />
  );

  const launch = (
    <ShellState
      className={shellClass}
      eyebrow="Planning"
      title={copy.title}
      detail={
        <>
          {research ? `${copy.detail} ${research}` : copy.detail}
          {planning.refusal ? (
            <p className="mt-2" data-testid="planning-append-planning-closed">
              {planning.refusal}
            </p>
          ) : null}
          {error ? (
            <p className="mt-2 text-sm text-destructive">{error}</p>
          ) : null}
        </>
      }
      action={
        <div
          className={
            append
              ? "flex w-full max-w-md flex-col items-center gap-3"
              : "flex flex-wrap items-center justify-center gap-2"
          }
        >
          <div
            className={
              append
                ? "flex flex-wrap items-center justify-center gap-2"
                : "contents"
            }
          >
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
            {append ? (
              <PlanningMergeBaseReadout value={mergeBaseValue} />
            ) : (
              <PlanningMergeBaseControl
                issueId={issue.id}
                value={mergeBaseControl.mergeBase}
                disabled={saving}
                onChange={mergeBaseControl.onChange}
              />
            )}
            {stakeholder ? (
              <IdeaGateChipButton
                issue={issue}
                field="outlineGate"
                label="Outline gate"
                testId="detail-outline-gate"
                enabled={outlineGateControl.enabled}
                onToggle={outlineGateControl.onToggle}
                saving={outlineGateControl.saving}
              />
            ) : null}
            {stakeholder && !append ? (
              <ExecutionGateChip issue={issue} testId="detail-execution-gate" />
            ) : null}
            {append
              ? null
              : launchButton(
                  saving ||
                    mergeBaseControl.pending ||
                    !mergeBaseControl.mergeBase.trim(),
                  issue.appendTo ? undefined : mergeBaseControl.writeMergeBase,
                )}
          </div>
          {append && mergeBaseHint ? (
            <p
              data-testid="planning-merge-base-hint"
              className="text-center text-sm text-muted-foreground"
            >
              {mergeBaseHint}
            </p>
          ) : null}
          {append ? launchButton(saving || planning.launchBlocked) : null}
        </div>
      }
    />
  );

  if (!showCallout || !append) return launch;

  return (
    <div className="flex flex-col gap-4">
      <AppendPlanningCallout storyTitle={append.storyTitle} />
      {launch}
    </div>
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
  const planning = useAppendPlanningContext(issue);
  const [selectedCatalogId, setSelectedCatalogId] = useState<string | undefined>();

  useEffect(() => {
    if (defaultModel && selectedCatalogId === undefined) {
      setSelectedCatalogId(defaultModel);
    }
  }, [defaultModel, selectedCatalogId]);

  return (
    <div className="flex flex-col items-end gap-1">
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
          optimistic
          disabled={planning.launchBlocked}
          onStarted={onStarted}
        />
      </div>
      {planning.refusal ? (
        <p
          data-testid="planning-new-run-blocked"
          className="max-w-xs text-right text-[11px] leading-snug text-muted-foreground"
        >
          {planning.refusal}
        </p>
      ) : null}
    </div>
  );
}
