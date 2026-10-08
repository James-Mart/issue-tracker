import { FIELD_LABELS } from "@server/fields";
import { isProjectBoardChild } from "@server/order";
import type { IssueDetail } from "@server/schemas";
import {
  IssueLinkResolution,
  useSupplementedById,
} from "../hooks/use-supplemented-by-id";
import { IssueLink } from "./issue-link";
import { MetaRow } from "./meta-row";

type PlanRootDetail = Extract<IssueDetail, { kind: "epic" | "story" }>;

export function IssueSourceIdeaField({
  issue,
}: {
  issue: PlanRootDetail;
}) {
  const sourceIdeaId = issue.sourceIdea;
  const supplement = useSupplementedById(
    sourceIdeaId ? [sourceIdeaId] : [],
    issue,
  );
  const { byId, missingIds, accept, reject } = supplement;

  if (!sourceIdeaId) return null;

  if (issue.kind === "story" && !isProjectBoardChild(issue, byId)) {
    return null;
  }

  const idea = byId.get(sourceIdeaId);
  const title = idea?.title ?? sourceIdeaId;

  return (
    <MetaRow
      label={FIELD_LABELS.sourceIdea}
      value={
        <>
          <IssueLinkResolution
            missingIds={missingIds}
            accept={accept}
            reject={reject}
          />
          <IssueLink id={sourceIdeaId} supplement={supplement}>
            {title}
          </IssueLink>
        </>
      }
    />
  );
}
