import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { FIELD_LABELS } from "@server/fields";
import type { IssueDetail, IssueRecord, PendingAppend } from "@server/schemas";
import { useIssuesQuery } from "../api/queries";
import { issuesById } from "../lib/build-tree";
import { ideaExecutionGateOption } from "../lib/idea-execution-gate-options";
import {
  type IssueBackLocationState,
  issueBackNavigateState,
} from "../lib/issue-back";
import { issuePath } from "../lib/links";
import { DetailEyebrow } from "./detail-section";

type OutlineDetail = Extract<IssueDetail, { kind: "outline" }>;

/**
 * Appends waiting for reconcile. Absent — no heading, no empty state —
 * when the outline has none.
 */
export function OutlinePendingAppendsCard({
  issue,
}: {
  issue: OutlineDetail;
}) {
  const appends = issue.pendingAppends;
  const issues = useIssuesQuery();
  const byId = useMemo(
    () => issuesById(issues.data?.issues ?? []),
    [issues.data?.issues],
  );
  if (!appends || appends.length === 0) return null;

  return (
    <section
      className="rounded-lg border border-border bg-card p-5"
      data-testid="outline-pending-appends"
    >
      <div className="mb-3 flex min-h-8 items-center gap-2">
        <DetailEyebrow>Pending appends</DetailEyebrow>
      </div>
      <ul className="flex list-none flex-col divide-y divide-border p-0">
        {appends.map((entry) => (
          <li key={entry.sourceIdea}>
            <PendingAppendRow issue={issue} entry={entry} byId={byId} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function PendingAppendRow({
  issue,
  entry,
  byId,
}: {
  issue: OutlineDetail;
  entry: PendingAppend;
  byId: ReadonlyMap<string, IssueRecord>;
}) {
  const location = useLocation();
  const linkState = issueBackNavigateState(
    location.pathname,
    location.search,
    (location.state as IssueBackLocationState | null)?.issueBackStack,
  );
  const titleOf = (id: string) => byId.get(id)?.title ?? id;
  const gate = ideaExecutionGateOption(entry.executionGate);

  return (
    <div
      data-testid={`outline-pending-append-${entry.sourceIdea}`}
      className="flex flex-col gap-1 py-2.5"
    >
      <Link
        to={issuePath(issue.partOf, entry.targetStory)}
        state={linkState}
        className="truncate font-medium text-foreground hover:underline"
      >
        {titleOf(entry.targetStory)}
      </Link>
      <p className="text-sm text-muted-foreground">
        From{" "}
        <Link
          to={issuePath(issue.partOf, entry.sourceIdea)}
          state={linkState}
          className="text-primary hover:underline"
        >
          {titleOf(entry.sourceIdea)}
        </Link>
        {" · "}
        {FIELD_LABELS.executionGate} · {gate.label}
        {" · "}
        {FIELD_LABELS.codeApprovalRequired} ·{" "}
        {entry.codeApprovalRequired ? "Yes" : "No"}
      </p>
    </div>
  );
}
