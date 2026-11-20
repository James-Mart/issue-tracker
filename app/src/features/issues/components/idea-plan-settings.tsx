import { useEffect, useState } from "react";
import { FIELD_LABELS } from "@server/fields";
import type { ExecutionGate, IssuePatch, IssueRecord } from "@server/schemas";
import { cn } from "@/lib/utils/cn";
import { useUpdateIssue } from "../api/mutations";
import { useIssuePatchAction } from "../hooks/use-issue-patch-action";
import { IDEA_EXECUTION_GATE_OPTIONS } from "../lib/idea-execution-gate-options";
import { planSettingVisibility } from "../lib/idea-plan-setting-visibility";
import { GateToggleButton } from "./gate-toggle-button";

type IdeaRecord = Extract<IssueRecord, { kind: "idea" }>;

export type IdeaPlanSettingsState = ReturnType<typeof useIdeaPlanSettings>;

function nextExecutionGate(
  current: ExecutionGate,
  key: string,
): { value: ExecutionGate; index: number } | undefined {
  const index = IDEA_EXECUTION_GATE_OPTIONS.findIndex(
    (option) => option.value === current,
  );
  const last = IDEA_EXECUTION_GATE_OPTIONS.length - 1;
  const nextIndex =
    key === "ArrowRight" || key === "ArrowDown"
      ? index === last
        ? 0
        : index + 1
      : key === "ArrowLeft" || key === "ArrowUp"
        ? index === 0
          ? last
          : index - 1
        : undefined;
  if (nextIndex === undefined) return undefined;
  return {
    value: IDEA_EXECUTION_GATE_OPTIONS[nextIndex].value,
    index: nextIndex,
  };
}

export function useIdeaPlanSettings(issue: IdeaRecord) {
  const update = useUpdateIssue();
  const { saving, run } = useIssuePatchAction();
  const [outOfBand, setOutOfBand] = useState(issue.outOfBand === true);
  const [decomposition, setDecomposition] = useState(issue.decompositionGate === true);
  const [execution, setExecution] = useState<ExecutionGate>(issue.executionGate);

  useEffect(() => {
    setOutOfBand(issue.outOfBand === true);
    setDecomposition(issue.decompositionGate === true);
    setExecution(issue.executionGate);
  }, [issue.id, issue.outOfBand, issue.decompositionGate, issue.executionGate]);

  const commit = (patch: IssuePatch, rollback: () => void) => {
    void run(async () => {
      try {
        await update.mutateAsync({ id: issue.id, patch });
      } catch (err) {
        rollback();
        throw err;
      }
    });
  };

  const shown = planSettingVisibility({
    outOfBand,
    decompositionGate: decomposition,
  });

  return {
    saving,
    outOfBand,
    decomposition,
    execution,
    shown,
    toggleOutOfBand: () => {
      if (saving) return;
      const next = !outOfBand;
      const previous = outOfBand;
      setOutOfBand(next);
      commit({ outOfBand: next }, () => setOutOfBand(previous));
    },
    toggleDecomposition: () => {
      if (saving) return;
      const next = !decomposition;
      const previous = decomposition;
      setDecomposition(next);
      commit({ decompositionGate: next }, () => setDecomposition(previous));
    },
    setExecutionGate: (next: ExecutionGate) => {
      if (saving || Object.is(next, execution)) return;
      const previous = execution;
      setExecution(next);
      commit({ executionGate: next }, () => setExecution(previous));
    },
  };
}

function ExecutionGateControl({
  id,
  value,
  onChange,
  disabled,
  testId,
}: {
  id: string;
  value: ExecutionGate;
  onChange: (next: ExecutionGate) => void;
  disabled?: boolean;
  testId: string;
}) {
  return (
    <div
      id={id}
      role="radiogroup"
      aria-label={FIELD_LABELS.executionGate}
      data-testid={testId}
      data-value={
        IDEA_EXECUTION_GATE_OPTIONS.find((option) => option.value === value)
          ?.slug
      }
      className="inline-flex h-7 w-fit items-center rounded-md border border-border bg-card px-2 font-mono text-[10px] tracking-[0.08em] touch:h-11"
      onKeyDown={(event) => {
        if (disabled) return;
        const next = nextExecutionGate(value, event.key);
        if (next === undefined) return;
        event.preventDefault();
        onChange(next.value);
        const radios = event.currentTarget.querySelectorAll<HTMLButtonElement>(
          'button[role="radio"]',
        );
        radios[next.index]?.focus();
      }}
    >
      <span aria-hidden className="text-muted-foreground">
        {FIELD_LABELS.executionGate} ·
      </span>
      {IDEA_EXECUTION_GATE_OPTIONS.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.slug}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            data-testid={`${testId}-${option.slug}`}
            disabled={disabled}
            className={cn(
              "h-full rounded-sm px-1.5 touch:min-w-11",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? "text-[hsl(var(--current))]"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function IdeaPlanSettingsControls({
  issue,
  testIdPrefix,
  settings,
}: {
  issue: IdeaRecord;
  testIdPrefix: "flow-row" | "detail";
  settings: IdeaPlanSettingsState;
}) {
  if (issue.archived) return null;

  return (
    <>
      {settings.shown.decomposition ? (
        <GateToggleButton
          id={`decomposition-gate-${issue.id}`}
          label={FIELD_LABELS.decompositionGate}
          testId={`${testIdPrefix}-decomposition-gate`}
          enabled={settings.decomposition}
          onToggle={settings.toggleDecomposition}
          disabled={settings.saving}
        />
      ) : null}
      {settings.shown.execution ? (
        <ExecutionGateControl
          id={`execution-gate-${issue.id}`}
          testId={`${testIdPrefix}-execution-gate`}
          value={settings.execution}
          onChange={settings.setExecutionGate}
          disabled={settings.saving}
        />
      ) : null}
      <GateToggleButton
        id={`out-of-band-${issue.id}`}
        label={FIELD_LABELS.outOfBand}
        testId={`${testIdPrefix}-out-of-band`}
        enabled={settings.outOfBand}
        onToggle={settings.toggleOutOfBand}
        disabled={settings.saving}
      />
    </>
  );
}

/** Decomposition, execution, and out-of-band controls for an unarchived Idea. */
export function IdeaPlanSettings({
  issue,
  testIdPrefix,
}: {
  issue: IdeaRecord;
  testIdPrefix: "flow-row" | "detail";
}) {
  const settings = useIdeaPlanSettings(issue);
  return (
    <IdeaPlanSettingsControls
      issue={issue}
      testIdPrefix={testIdPrefix}
      settings={settings}
    />
  );
}

