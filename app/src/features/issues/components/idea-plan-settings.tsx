import { useEffect, useState } from "react";
import { FIELD_LABELS } from "@server/fields";
import type { ExecutionGate, IssuePatch, IssueRecord } from "@server/schemas";
import { cn } from "@/lib/utils/cn";
import { useUpdateIssue } from "../api/mutations";
import { useIssuePatchAction } from "../hooks/use-issue-patch-action";
import { GateToggleButton } from "./gate-toggle-button";

type IdeaRecord = Extract<IssueRecord, { kind: "idea" }>;

const EXECUTION_GATE_OPTIONS: readonly {
  value: ExecutionGate;
  label: string;
  slug: string;
}[] = [
  { value: "auto", label: "Auto", slug: "auto" },
  { value: true, label: "On", slug: "on" },
  { value: false, label: "Off", slug: "off" },
];

function nextExecutionGate(
  current: ExecutionGate,
  key: string,
): { value: ExecutionGate; index: number } | undefined {
  const index = EXECUTION_GATE_OPTIONS.findIndex((option) => option.value === current);
  const last = EXECUTION_GATE_OPTIONS.length - 1;
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
  return { value: EXECUTION_GATE_OPTIONS[nextIndex].value, index: nextIndex };
}

/**
 * Out of band hides the other two controls. Execution stays hidden while the
 * decomposition gate is on, including for an append Idea.
 */
function planSettingVisibility(input: {
  outOfBand: boolean;
  decompositionGate: boolean;
}): { decomposition: boolean; execution: boolean } {
  if (input.outOfBand) {
    return { decomposition: false, execution: false };
  }
  return {
    decomposition: true,
    execution: !input.decompositionGate,
  };
}

function useIdeaPlanSettings(issue: IdeaRecord) {
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

  return {
    saving,
    outOfBand,
    decomposition,
    execution,
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
        EXECUTION_GATE_OPTIONS.find((option) => option.value === value)?.slug
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
      {EXECUTION_GATE_OPTIONS.map((option) => {
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

/** Decomposition, execution, and out-of-band controls for an unarchived Idea. */
export function IdeaPlanSettings({
  issue,
  testIdPrefix,
}: {
  issue: IdeaRecord;
  testIdPrefix: "flow-row" | "detail";
}) {
  const settings = useIdeaPlanSettings(issue);
  if (issue.archived) return null;

  const shown = planSettingVisibility({
    outOfBand: settings.outOfBand,
    decompositionGate: settings.decomposition,
  });

  return (
    <>
      {shown.decomposition ? (
        <GateToggleButton
          id={`decomposition-gate-${issue.id}`}
          label={FIELD_LABELS.decompositionGate}
          testId={`${testIdPrefix}-decomposition-gate`}
          enabled={settings.decomposition}
          onToggle={settings.toggleDecomposition}
          disabled={settings.saving}
        />
      ) : null}
      {shown.execution ? (
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

