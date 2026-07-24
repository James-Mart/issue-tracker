import { useEffect, useState } from "react";
import type { IssueDetail } from "@server/schemas";
import { useUpdateIssue } from "../api/mutations";
import { useIssuePatchAction } from "../hooks/use-issue-patch-action";
import {
  supportingDocsDraftFromIssue,
  supportingDocsEqual,
  supportingDocsFromDraftPreservingIncomplete,
  type SupportingDocsDraft,
} from "../lib/supporting-docs";
import { SupportingDocsEditor } from "./supporting-docs-editor";

export function IssueSupportingDocsField({
  issue,
}: {
  issue: Extract<IssueDetail, { kind: "project" }>;
}) {
  const update = useUpdateIssue();
  const { error, saving, run } = useIssuePatchAction();
  const [draft, setDraft] = useState(() =>
    supportingDocsDraftFromIssue(issue.supportingDocs),
  );

  useEffect(() => {
    setDraft(supportingDocsDraftFromIssue(issue.supportingDocs));
  }, [issue.supportingDocs]);

  const persist = (next: SupportingDocsDraft) => {
    setDraft(next);
    const docs = supportingDocsFromDraftPreservingIncomplete(
      next,
      issue.supportingDocs,
    );
    if (supportingDocsEqual(docs, issue.supportingDocs)) return;
    void run(async () => {
      await update.mutateAsync({
        id: issue.id,
        patch: { supportingDocs: docs },
      });
    });
  };

  return (
    <SupportingDocsEditor
      issueId={issue.id}
      draft={draft}
      disabled={saving}
      error={error}
      onChange={setDraft}
      onCommit={persist}
    />
  );
}
