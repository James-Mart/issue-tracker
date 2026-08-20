import { useMemo } from "react";
import { FIELD_LABELS } from "@server/fields";
import { isProjectBoardChild } from "@server/order";
import type { IssueDetail } from "@server/schemas";
import { useIssuesQuery } from "../api/queries";
import { issuesById } from "../lib/build-tree";
import { IssueLink } from "./issue-link";
import { MetaRow } from "./meta-row";

type PlanRootDetail = Extract<IssueDetail, { kind: "epic" | "story" }>;

export function IssueSourceIdeaField({
  issue,
}: {
  issue: PlanRootDetail;
}) {
  const sourceIdeaId = issue.sourceIdea;
  const { data } = useIssuesQuery();
  const byId = useMemo(() => issuesById(data?.issues ?? []), [data?.issues]);

  if (!sourceIdeaId) return null;

  if (issue.kind === "story" && !isProjectBoardChild(issue, byId)) {
    return null;
  }

  const idea = byId.get(sourceIdeaId);
  const title = idea?.title ?? sourceIdeaId;

  return (
    <MetaRow
      label={FIELD_LABELS.sourceIdea}
      value={<IssueLink id={sourceIdeaId}>{title}</IssueLink>}
    />
  );
}
