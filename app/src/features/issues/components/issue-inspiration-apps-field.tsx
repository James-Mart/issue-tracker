import { useEffect, useState } from "react";
import type { IssueDetail } from "@server/schemas";
import { useUpdateIssue } from "../api/mutations";
import { useIssuePatchAction } from "../hooks/use-issue-patch-action";
import {
  inspirationAppDraftsFromIssue,
  planInspirationAppsSave,
  type InspirationAppDraft,
} from "../lib/inspiration-apps";
import { InspirationAppsEditor } from "./inspiration-apps-editor";

export function IssueInspirationAppsField({
  issue,
}: {
  issue: Extract<IssueDetail, { kind: "project" }>;
}) {
  const update = useUpdateIssue();
  const { error, saving, run } = useIssuePatchAction();
  const [drafts, setDrafts] = useState(() =>
    inspirationAppDraftsFromIssue(issue.inspirationApps),
  );
  const [appsError, setAppsError] = useState<string | null>(null);

  useEffect(() => {
    setDrafts(inspirationAppDraftsFromIssue(issue.inspirationApps));
    setAppsError(null);
  }, [issue.inspirationApps]);

  const persist = (next: InspirationAppDraft[]) => {
    setDrafts(next);
    const result = planInspirationAppsSave(issue.inspirationApps, next);
    if (!result.ok) {
      setAppsError(result.error);
      return;
    }
    setAppsError(null);
    if (result.apps === null) return;
    void run(async () => {
      await update.mutateAsync({
        id: issue.id,
        patch: { inspirationApps: result.apps },
      });
    });
  };

  return (
    <InspirationAppsEditor
      drafts={drafts}
      disabled={saving}
      error={appsError ?? error}
      onChange={(next) => {
        setDrafts(next);
        setAppsError(null);
      }}
      onCommit={persist}
    />
  );
}
