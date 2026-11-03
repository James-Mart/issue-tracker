import { FIELD_LABELS } from "@server/fields";
import type { IssueDetail } from "@server/schemas";
import {
  IssueLinkResolution,
  useSupplementedById,
} from "../hooks/use-supplemented-by-id";
import { outlineVersionLabel } from "../lib/project-outlines";
import { IssueLink } from "./issue-link";
import { MetaFieldActions, MetaRow } from "./meta-row";

type StampedDetail = Extract<IssueDetail, { kind: "epic" | "story" | "task" }>;

/** Linked outline and stamped version. Hidden when `sourceOutline` is unset. */
export function IssueSourceOutlineField({ issue }: { issue: StampedDetail }) {
  const stamp = issue.sourceOutline;
  const supplement = useSupplementedById(
    stamp ? [stamp.outline] : [],
    issue,
  );
  if (!stamp) return null;

  const title = supplement.byId.get(stamp.outline)?.title ?? stamp.outline;
  return (
    <MetaRow
      label={FIELD_LABELS.sourceOutline}
      value={
        <MetaFieldActions>
          <IssueLinkResolution
            missingIds={supplement.missingIds}
            accept={supplement.accept}
            reject={supplement.reject}
          />
          <IssueLink
            id={stamp.outline}
            supplement={supplement}
            className="text-primary hover:underline"
          >
            {title}
          </IssueLink>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {outlineVersionLabel(stamp.version)}
          </span>
        </MetaFieldActions>
      }
    />
  );
}
