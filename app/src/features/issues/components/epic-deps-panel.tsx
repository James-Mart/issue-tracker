import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { FIELD_LABELS } from "@server/fields";
import type { DerivedState, IssueDetail, IssueRecord } from "@server/schemas";
import { DependencyGraph } from "@/components/ui/dependency-graph";
import { useIssuesQuery } from "../api/queries";
import { depGraphModel, epicDependencyNeighborhood } from "../lib/flow";
import { issuePath } from "../lib/links";
import { IssueBlockedByField } from "./issue-blocked-by-field";

function EpicDepsView({
  issue,
  issues,
  derived,
}: {
  issue: Extract<IssueDetail, { kind: "epic" }>;
  issues: IssueRecord[];
  derived: Record<string, DerivedState>;
}) {
  const { projectId = "" } = useParams();
  const model = useMemo(() => {
    const neighborhood = epicDependencyNeighborhood(issue.id, issues);
    return depGraphModel(neighborhood, derived);
  }, [derived, issue.id, issues]);

  return (
    <div
      data-testid="epic-dep-neighborhood"
      className="flex flex-wrap items-start gap-6"
    >
      <DependencyGraph
        model={model}
        nodeHref={(node) => issuePath(projectId, node.id)}
      />
      <div className="flex min-w-[12rem] max-w-sm flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {FIELD_LABELS.blockedBy}
        </span>
        <IssueBlockedByField issue={issue} derived={derived} />
      </div>
    </div>
  );
}

/** Epic own-flow: dependency neighborhood DAG + scalar blockedBy editing. */
export function EpicDepsPanel({
  issue,
}: {
  issue: Extract<IssueDetail, { kind: "epic" }>;
}) {
  const { data } = useIssuesQuery();
  const issues = useMemo(() => data?.issues ?? [], [data?.issues]);
  if (!data) return null;
  return (
    <EpicDepsView issue={issue} issues={issues} derived={data.derived} />
  );
}
