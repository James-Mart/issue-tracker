import { useEffect, useState } from "react";
import type { IssueDetail, ProjectLabel } from "@server/schemas";
import { useUpdateIssue } from "../api/mutations";
import { useIssuePatchAction } from "../hooks/use-issue-patch-action";
import {
  applyCatalogLabelsPlan,
  catalogDraftsFromIssue,
  planCatalogLabelsSave,
  type CatalogDraft,
} from "../lib/project-labels";
import { ProjectLabelsEditor } from "./project-labels-editor";

export function IssueProjectLabelsField({
  issue,
}: {
  issue: Extract<IssueDetail, { kind: "project" }>;
}) {
  const update = useUpdateIssue();
  const { error, saving, run } = useIssuePatchAction();
  const [drafts, setDrafts] = useState(() =>
    catalogDraftsFromIssue(issue.labels),
  );
  const [labelsError, setLabelsError] = useState<string | null>(null);

  useEffect(() => {
    setDrafts(catalogDraftsFromIssue(issue.labels));
    setLabelsError(null);
  }, [issue.labels]);

  const persist = (next: CatalogDraft[]) => {
    setDrafts(next);
    const result = planCatalogLabelsSave(issue.labels, next);
    if (!result.ok) {
      setLabelsError(result.error);
      return;
    }
    setLabelsError(null);
    if (
      result.plan.stagingPatches.length === 0 &&
      result.plan.finalLabels === null
    ) {
      return;
    }
    void run(async () => {
      const apply = async (labels: ProjectLabel[]) => {
        await update.mutateAsync({ id: issue.id, patch: { labels } });
      };
      const finalLabels = await applyCatalogLabelsPlan(result.plan, apply);
      if (finalLabels) await apply(finalLabels);
    });
  };

  return (
    <ProjectLabelsEditor
      drafts={drafts}
      disabled={saving}
      error={labelsError ?? error}
      onChange={(next) => {
        setDrafts(next);
        setLabelsError(null);
      }}
      onCommit={persist}
    />
  );
}
