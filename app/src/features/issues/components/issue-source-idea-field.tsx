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
  const { byId } = supplement;

  if (!sourceIdeaId) return null;

  if (issue.kind === "story" && !isProjectBoardChild(issue, byId)) {
    return null;
  }

  return (
    <MetaRow
      label={FIELD_LABELS.sourceIdea}
      value={
        <SourceIdeaAnchor
          sourceIdeaId={sourceIdeaId}
          supplement={supplement}
        />
      }
    />
  );
}

/** The linked Idea title for a stored `sourceIdea`, once the caller has the supplement. */
export function SourceIdeaAnchor({
  sourceIdeaId,
  supplement,
  className,
}: {
  sourceIdeaId: string;
  supplement: ReturnType<typeof useSupplementedById>;
  className?: string;
}) {
  const { byId, missingIds, accept, reject } = supplement;
  const title = byId.get(sourceIdeaId)?.title ?? sourceIdeaId;
  return (
    <>
      <IssueLinkResolution
        missingIds={missingIds}
        accept={accept}
        reject={reject}
      />
      <IssueLink id={sourceIdeaId} supplement={supplement} className={className}>
        {title}
      </IssueLink>
    </>
  );
}
