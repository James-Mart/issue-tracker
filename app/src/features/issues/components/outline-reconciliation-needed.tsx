import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { IssueDetail } from "@server/schemas";
import { Button } from "@/components/ui/button";
import { useReconcileOutline } from "../api/mutations";
import { useIssuesQuery } from "../api/queries";
import type { StartedChannelSession } from "../api/channel-sessions";
import { issuePath } from "../lib/links";
import { reconciliationNeededRows } from "../lib/outline-links";
import {
  AxisChips,
  BEHIND_AXIS_CHIP,
  PENDING_APPEND_AXIS_CHIP,
} from "./axis-chips";
import { DetailEyebrow } from "./detail-section";

type OutlineDetail = Extract<IssueDetail, { kind: "outline" }>;

/**
 * Decomposition tab list of behind open roots and pending-append targets.
 * One Reconcile action starts reconcile at the latest version. Renders
 * nothing when that list is empty.
 */
export function OutlineReconciliationNeeded({
  outline,
  blocked = false,
  onStarted,
}: {
  outline: OutlineDetail;
  /** A live run on either outline channel would refuse the start. */
  blocked?: boolean;
  onStarted: (session: StartedChannelSession) => void;
}) {
  const issues = useIssuesQuery();
  const reconcile = useReconcileOutline(outline.id);
  const rows = useMemo(
    () =>
      reconciliationNeededRows(
        outline.id,
        outline.pendingAppends,
        issues.data?.issues ?? [],
        issues.data?.derived ?? {},
      ),
    [issues.data, outline.id, outline.pendingAppends],
  );

  if (rows.length === 0) return null;

  const start = () => {
    reconcile.mutate(undefined, { onSuccess: onStarted });
  };

  return (
    <section
      data-testid="outline-reconciliation-needed"
      className="shrink-0 border-b border-border px-4 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DetailEyebrow>Reconciliation needed</DetailEyebrow>
        <Button
          type="button"
          variant="primary"
          size="sm"
          data-testid="outline-reconcile"
          disabled={blocked || reconcile.isPending}
          onClick={start}
        >
          Reconcile
        </Button>
      </div>
      <ul className="mt-2 flex list-none flex-col gap-1 p-0">
        {rows.map((row) => (
          <li
            key={row.id}
            data-testid={`outline-reconciliation-row-${row.id}`}
            className="flex min-w-0 items-center justify-between gap-3 py-1"
          >
            <Link
              to={issuePath(outline.partOf, row.id)}
              className="min-w-0 truncate text-sm font-medium text-foreground hover:underline"
            >
              {row.title}
            </Link>
            <AxisChips
              chips={[
                ...(row.behind ? [BEHIND_AXIS_CHIP] : []),
                ...(row.pendingAppend ? [PENDING_APPEND_AXIS_CHIP] : []),
              ]}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
