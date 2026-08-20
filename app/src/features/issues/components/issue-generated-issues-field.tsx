import { useMemo } from "react";
import { FIELD_LABELS } from "@server/fields";
import type { IssueDetail } from "@server/schemas";
import { useIssuesQuery } from "../api/queries";
import { issuesById } from "../lib/build-tree";
import { IssueLink } from "./issue-link";
import { MetaRow } from "./meta-row";

type IdeaDetail = Extract<IssueDetail, { kind: "idea" }>;

export function IssueGeneratedIssuesField({ issue }: { issue: IdeaDetail }) {
  const { data } = useIssuesQuery();
  const planRoots = data?.derived?.[issue.id]?.planRoots ?? [];
  const byId = useMemo(() => issuesById(data?.issues ?? []), [data?.issues]);

  if (planRoots.length === 0) return null;

  return (
    <MetaRow
      label={FIELD_LABELS.generatedIssues}
      value={
        <span className="flex flex-col gap-1">
          {planRoots.map((rootId) => {
            const root = byId.get(rootId);
            const title = root?.title ?? rootId;
            return (
              <IssueLink key={rootId} id={rootId}>
                {title}
              </IssueLink>
            );
          })}
        </span>
      }
    />
  );
}
