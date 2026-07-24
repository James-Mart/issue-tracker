import { useMemo } from "react";
import type { DerivedState, IssueRecord } from "@server/schemas";
import { DependencyGraph } from "@/components/ui/dependency-graph";
import { depGraphModel, projectEpics } from "../lib/flow";
import { issuePath } from "../lib/links";
import { useIssueUiStore } from "../store/use-issue-ui-store";

/** Project-scoped Dependencies lens: epic `blockedBy` DAG via `DependencyGraph`. */
export function OverviewDependenciesLens({
  projectId,
  issues,
  derived,
}: {
  projectId: string;
  issues: IssueRecord[];
  derived: Record<string, DerivedState>;
}) {
  const showArchived = useIssueUiStore((s) => s.showArchived);

  const model = useMemo(() => {
    const epics = projectEpics(issues, projectId, showArchived);
    return depGraphModel(epics, derived);
  }, [derived, issues, projectId, showArchived]);

  return (
    <div
      role="tabpanel"
      id="overview-lens-panel-dependencies"
      aria-labelledby="overview-lens-tab-dependencies"
      data-lens-mount="dependencies"
      className="flex flex-col gap-6"
    >
      <DependencyGraph
        model={model}
        nodeHref={(node) => issuePath(projectId, node.id)}
      />
    </div>
  );
}
