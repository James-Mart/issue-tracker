import type { IssueDetail } from "@server/schemas";
import { IssueBooleanPatchField } from "./issue-boolean-patch-field";

export function IssueMergedField({
  issue,
}: {
  issue: Extract<IssueDetail, { kind: "story" }>;
}) {
  return (
    <IssueBooleanPatchField
      issueId={issue.id}
      checked={issue.merged}
      labels={{ on: "yes", off: "no" }}
      patchFor={(merged) => ({ merged })}
    />
  );
}
