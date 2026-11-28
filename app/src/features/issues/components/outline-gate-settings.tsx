import type { ReactNode } from "react";
import { FIELD_LABELS } from "@server/fields";
import type { IssueDetail, IssuePatch } from "@server/schemas";
import { useUpdateIssue } from "../api/mutations";
import { useIssuePatchAction } from "../hooks/use-issue-patch-action";
import { ExecutionGateControl } from "./execution-gate-control";
import { IssueBooleanPatchField } from "./issue-boolean-patch-field";
import { MetaRow } from "./meta-row";

type OutlineDetail = Extract<IssueDetail, { kind: "outline" }>;

/** Wide enough that "Implemented out of band" stays on one line beside its control. */
const GATE_ROW_CLASS =
  "grid-cols-1 items-center gap-y-1 sm:grid-cols-[14rem_minmax(0,1fr)]";

/** Execution gate on an outline Overview. Absent stored value opens on Auto. */
function OutlineExecutionGateRow({ issue }: { issue: OutlineDetail }) {
  const update = useUpdateIssue();
  const { error, saving, run } = useIssuePatchAction();
  const value = issue.executionGate ?? "auto";

  return (
    <MetaRow
      className={GATE_ROW_CLASS}
      label={FIELD_LABELS.executionGate}
      value={
        <div className="flex min-w-0 flex-col gap-1">
          <ExecutionGateControl
            id={`outline-execution-gate-${issue.id}`}
            testId="outline-overview-execution-gate"
            appearance="field"
            value={value}
            disabled={saving}
            onChange={(executionGate) => {
              if (executionGate === value) return;
              void run(async () => {
                await update.mutateAsync({
                  id: issue.id,
                  patch: { executionGate },
                });
              });
            }}
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
      }
    />
  );
}

function OutlineBooleanGateRow({
  issue,
  label,
  checked,
  testId,
  patchFor,
}: {
  issue: OutlineDetail;
  label: string;
  checked: boolean;
  testId: string;
  patchFor: (next: boolean) => IssuePatch;
}) {
  return (
    <MetaRow
      className={GATE_ROW_CLASS}
      label={label}
      value={
        <IssueBooleanPatchField
          issueId={issue.id}
          checked={checked}
          labels={{ on: "on", off: "off" }}
          testId={testId}
          patchFor={patchFor}
        />
      }
    />
  );
}

function OutlineCodeApprovalRow({ issue }: { issue: OutlineDetail }) {
  return (
    <OutlineBooleanGateRow
      issue={issue}
      label={FIELD_LABELS.codeApprovalRequired}
      checked={issue.codeApprovalRequired === true}
      testId="outline-overview-code-approval"
      patchFor={(next) => ({ codeApprovalRequired: next })}
    />
  );
}

function OutlineOutOfBandRow({ issue }: { issue: OutlineDetail }) {
  return (
    <OutlineBooleanGateRow
      issue={issue}
      label={FIELD_LABELS.outOfBand}
      checked={issue.outOfBand === true}
      testId="outline-overview-out-of-band"
      patchFor={(next) => ({ outOfBand: next })}
    />
  );
}

/** Overview property row for one outline gate setting. */
export function outlineGateRow(
  id: "executionGate" | "codeApprovalRequired" | "outOfBand",
  issue: OutlineDetail,
): ReactNode {
  switch (id) {
    case "executionGate":
      return <OutlineExecutionGateRow key="executionGate" issue={issue} />;
    case "codeApprovalRequired":
      return <OutlineCodeApprovalRow key="codeApprovalRequired" issue={issue} />;
    case "outOfBand":
      return <OutlineOutOfBandRow key="outOfBand" issue={issue} />;
  }
}
