import { useEffect, useMemo, useState } from "react";
import { FIELD_LABELS } from "@server/fields";
import type { ExecutionGate, IssueDetail } from "@server/schemas";
import { outlineDecomposeStart } from "@server/services/decompose-readiness";
import { ShellState } from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import { useDecomposeOutline, useUpdateIssue } from "../api/mutations";
import { useIssuesQuery } from "../api/queries";
import { useIssuePatchAction } from "../hooks/use-issue-patch-action";
import { READY_TO_DECOMPOSE_LABEL } from "../lib/derived";
import { decomposeRootsForOutline } from "../lib/outline-links";
import { outlineVersionLabel } from "../lib/project-outlines";
import { ExecutionGateControl } from "./execution-gate-control";
import { ExecutionGateEffectLine } from "./execution-gate-effect-line";
import { GateToggleButton } from "./gate-toggle-button";

type OutlineDetail = Extract<IssueDetail, { kind: "outline" }>;

const EMPTY_CLASS = "border-0 bg-transparent px-4 py-8 shadow-none";

const GATE_SENTENCE =
  "Execution gate follows the source Idea unless you override it here.";

const READY_DETAIL = `Launch a decomposer on the latest saved outline version. ${GATE_SENTENCE}`;

const OUT_OF_BAND_DETAIL =
  "Turning this off makes the outline ready to decompose.";

/** Decomposition tab when that channel has no session. */
export function OutlineDecompositionEmptyState({
  label,
  outline,
  blocked = false,
}: {
  label: string;
  outline: OutlineDetail;
  /** The outline's other channel has a live run, so Decompose would be refused. */
  blocked?: boolean;
}) {
  const update = useUpdateIssue();
  const decompose = useDecomposeOutline(outline.id);
  const { saving, run } = useIssuePatchAction();
  const issues = useIssuesQuery("include");
  const [outOfBand, setOutOfBand] = useState(outline.outOfBand === true);
  // Absent stored gate is Auto, the same default conclude copies onto the outline.
  const [executionGate, setExecutionGate] = useState<ExecutionGate>(
    outline.executionGate ?? "auto",
  );

  useEffect(() => {
    setOutOfBand(outline.outOfBand === true);
    setExecutionGate(outline.executionGate ?? "auto");
  }, [outline.id, outline.outOfBand, outline.executionGate]);

  // This state is only mounted with no session on the channel, so no live
  // decomposition run is clearing Ready. Readiness is that structural half
  // with the toggle's current value, including before the list refetch lands.
  const roots = useMemo(() => {
    if (!issues.data) return undefined;
    return decomposeRootsForOutline(
      issues.data.issues,
      issues.data.derived,
      outline.id,
    );
  }, [issues.data, outline.id]);
  const decomposeStart =
    roots === undefined
      ? undefined
      : outlineDecomposeStart(
          {
            concludedAt: outline.concludedAt,
            outOfBand,
            bodyVersion: outline.bodyVersion,
          },
          roots,
        );
  const ready = decomposeStart?.ready === true;
  const from = decomposeStart?.from;

  const toggleOutOfBand = () => {
    if (saving) return;
    const next = !outOfBand;
    const previous = outOfBand;
    setOutOfBand(next);
    void run(async () => {
      try {
        await update.mutateAsync({
          id: outline.id,
          patch: { outOfBand: next },
        });
      } catch (err) {
        setOutOfBand(previous);
        throw err;
      }
    });
  };

  const start = () => {
    void run(async () => {
      await update.mutateAsync({
        id: outline.id,
        patch: { executionGate },
      });
      await decompose.mutateAsync(from);
    });
  };

  if (outOfBand) {
    return (
      <div data-testid="outline-decomposition-empty" data-state="out-of-band">
        <ShellState
          className={EMPTY_CLASS}
          eyebrow={label}
          title="Implemented out of band"
          detail={OUT_OF_BAND_DETAIL}
          action={
            <GateToggleButton
              id={`out-of-band-${outline.id}`}
              label={FIELD_LABELS.outOfBand}
              testId="outline-out-of-band"
              enabled={outOfBand}
              onToggle={toggleOutOfBand}
              disabled={saving}
            />
          }
        />
      </div>
    );
  }

  if (!issues.data && issues.isLoading) {
    return (
      <p
        role="status"
        className="px-4 py-8 text-center font-mono text-[11px] text-muted-foreground"
      >
        Loading…
      </p>
    );
  }

  if (!ready) {
    return (
      <div data-testid="outline-decomposition-empty" data-state="none">
        <ShellState
          className={EMPTY_CLASS}
          eyebrow={label}
          title={`No ${label.toLowerCase()} session.`}
          detail={`This channel is for ${label.toLowerCase()} work on this issue.`}
        />
      </div>
    );
  }

  return (
    <div data-testid="outline-decomposition-empty" data-state="ready">
      <ShellState
        className={EMPTY_CLASS}
        eyebrow={label}
        title={READY_TO_DECOMPOSE_LABEL}
        detail={
          from === undefined ? (
            READY_DETAIL
          ) : (
            <>
              Launch a decomposer from{" "}
              <span className="font-mono tabular-nums">
                {outlineVersionLabel(from)}
              </span>{" "}
              through the latest saved outline version. {GATE_SENTENCE}
            </>
          )
        }
        action={
          <div className="flex w-full flex-col items-center gap-3">
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                type="button"
                variant="primary"
                size="sm"
                data-testid="outline-decompose"
                disabled={saving || blocked}
                onClick={start}
              >
                Decompose
              </Button>
              <ExecutionGateControl
                id={`execution-gate-${outline.id}`}
                testId="outline-execution-gate"
                value={executionGate}
                onChange={setExecutionGate}
                disabled={saving || blocked}
              />
              <GateToggleButton
                id={`out-of-band-${outline.id}`}
                label={FIELD_LABELS.outOfBand}
                testId="outline-out-of-band"
                enabled={outOfBand}
                onToggle={toggleOutOfBand}
                disabled={saving}
              />
            </div>
            <ExecutionGateEffectLine
              value={executionGate}
              testId="outline-execution-gate-effect"
              className="w-full px-2"
            />
          </div>
        }
      />
    </div>
  );
}
