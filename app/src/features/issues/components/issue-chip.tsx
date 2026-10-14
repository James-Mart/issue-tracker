import { Badge } from "@/components/ui/badge";
import {
  IssueLinkResolution,
  useSupplementedById,
} from "../hooks/use-supplemented-by-id";
import { IssueLink } from "./issue-link";

/** Linked chip with an issue's title and id; the id alone until the issue loads. */
export function IssueChip({ id, testId }: { id: string; testId: string }) {
  const supplement = useSupplementedById([id]);
  const { byId, missingIds, accept, reject } = supplement;
  const title = byId.get(id)?.title ?? id;

  return (
    <span
      className="inline-flex max-w-full min-w-0 shrink-0"
      data-testid={testId}
    >
      <IssueLinkResolution
        missingIds={missingIds}
        accept={accept}
        reject={reject}
      />
      <IssueLink
        id={id}
        className="inline-flex max-w-full min-w-0 hover:underline"
        supplement={supplement}
      >
        <Badge
          variant="secondary"
          className="inline-flex max-w-full min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 whitespace-normal font-normal hover:border-[hsl(var(--rail-lit))]"
        >
          <span>{title}</span>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {id}
          </span>
        </Badge>
      </IssueLink>
    </span>
  );
}
