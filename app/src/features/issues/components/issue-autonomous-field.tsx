import type { IssueDetail } from "@server/schemas";
import { IssueBooleanPatchField } from "./issue-boolean-patch-field";

export function IssueAutonomousField({
  issue,
}: {
  issue: Extract<IssueDetail, { kind: "project" }>;
}) {
  return (
    <IssueBooleanPatchField
      issueId={issue.id}
      checked={issue.autonomous === true}
      labels={{ on: "Autonomous", off: "Autonomous" }}
      patchFor={(next) => ({ autonomous: next })}
    />
  );
}
