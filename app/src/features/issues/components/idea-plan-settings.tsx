import { useEffect, useState } from "react";
import { FIELD_LABELS } from "@server/fields";
import type { ExecutionGate, IssuePatch, IssueRecord } from "@server/schemas";
import { useUpdateIssue } from "../api/mutations";
import { useIssuePatchAction } from "../hooks/use-issue-patch-action";
import { planSettingVisibility } from "../lib/idea-plan-setting-visibility";
import { ExecutionGateControl } from "./execution-gate-control";
import { GateToggleButton } from "./gate-toggle-button";

type IdeaRecord = Extract<IssueRecord, { kind: "idea" }>;

export type IdeaPlanSettingsState = ReturnType<typeof useIdeaPlanSettings>;

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

