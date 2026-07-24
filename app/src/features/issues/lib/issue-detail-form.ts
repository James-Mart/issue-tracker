import {
  MERGE_POLICY_LABELS,
  type ProjectFormFieldKey,
} from "@server/fields";
import type { IssueDetail } from "@server/schemas";

export function blockedByFormValue(issue: IssueDetail): string {
  return issue.kind === "epic" ? issue.blockedBy.join(" ") : "";
}

export function parseIds(text: string): string[] {
  const seen = new Set<string>();
  for (const token of text.split(/[\s,]+/)) {
    if (token) seen.add(token);
  }
  return [...seen];
}

export type ProjectMetaValue = { text: string; mono?: boolean; muted?: boolean };

export function projectMetaValue(
  issue: Extract<IssueDetail, { kind: "project" }>,
  key: ProjectFormFieldKey,
): ProjectMetaValue {
  switch (key) {
    case "workspace":
      return issue.workspace
        ? { text: issue.workspace, mono: true }
        : { text: "not set", muted: true };
    case "mergePolicy":
      return { text: MERGE_POLICY_LABELS[issue.mergePolicy] };
  }
}
