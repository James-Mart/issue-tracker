import { useEffect, useState } from "react";
import type { IssueDetail } from "@server/schemas";
import { useUpdateIssue } from "../api/mutations";
import { useIssuePatchAction } from "../hooks/use-issue-patch-action";
import {
  personaDraftsFromIssue,
  planPersonasSave,
  type PersonaDraft,
} from "../lib/personas";
import { PersonasEditor } from "./personas-editor";

export function IssuePersonasField({
  issue,
}: {
  issue: Extract<IssueDetail, { kind: "project" }>;
}) {
  const update = useUpdateIssue();
  const { error, saving, run } = useIssuePatchAction();
  const [drafts, setDrafts] = useState(() =>
    personaDraftsFromIssue(issue.personas),
  );
  const [personasError, setPersonasError] = useState<string | null>(null);

  useEffect(() => {
    setDrafts(personaDraftsFromIssue(issue.personas));
    setPersonasError(null);
  }, [issue.personas]);

  const persist = (next: PersonaDraft[]) => {
    setDrafts(next);
    const result = planPersonasSave(issue.personas, next);
    if (!result.ok) {
      setPersonasError(result.error);
      return;
    }
    setPersonasError(null);
    if (result.personas === null) return;
    void run(async () => {
      await update.mutateAsync({
        id: issue.id,
        patch: { personas: result.personas },
      });
    });
  };

  return (
    <PersonasEditor
      drafts={drafts}
      disabled={saving}
      error={personasError ?? error}
      onChange={(next) => {
        setDrafts(next);
        setPersonasError(null);
      }}
      onCommit={persist}
    />
  );
}
