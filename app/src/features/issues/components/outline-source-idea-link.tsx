import { FIELD_LABELS } from "@server/fields";
import type { IssueDetail } from "@server/schemas";
import { useSupplementedById } from "../hooks/use-supplemented-by-id";
import { SourceIdeaAnchor } from "./issue-source-idea-field";

/** Header line for the Idea an outline was planned from. Absent when unset. */
export function OutlineSourceIdeaLink({
  issue,
}: {
  issue: Extract<IssueDetail, { kind: "outline" }>;
}) {
  const sourceIdeaId = issue.sourceIdea;
  const supplement = useSupplementedById(
    sourceIdeaId ? [sourceIdeaId] : [],
    issue,
  );

  if (!sourceIdeaId) return null;

  return (
    <p
      className="mt-1 flex flex-wrap items-baseline gap-x-2 text-sm"
      data-testid="outline-source-idea"
    >
      <span className="text-muted-foreground">{FIELD_LABELS.sourceIdea}</span>
      <SourceIdeaAnchor
        sourceIdeaId={sourceIdeaId}
        supplement={supplement}
        className="text-[hsl(var(--current))] hover:underline"
      />
    </p>
  );
}
