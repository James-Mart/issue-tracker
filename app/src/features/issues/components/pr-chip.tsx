import type { BadgeProps } from "@/components/ui/badge";
import { Badge } from "@/components/ui/badge";
import type { PrFacts, PrUnavailable } from "@server/services/delivery";

const UNAVAILABLE_LABEL = "PR state unavailable";

export type PrChipModel =
  | { kind: "hidden" }
  | {
      kind: "chip";
      label: string;
      variant: NonNullable<BadgeProps["variant"]>;
    };

function isPrUnavailable(
  value: PrFacts | PrUnavailable,
): value is PrUnavailable {
  return "reason" in value;
}

function draftPart(isDraft: boolean): string {
  return isDraft ? "Draft" : "Ready";
}

function checksPart(checks: PrFacts["checks"]): string {
  if (checks.state === "success") return "Success";
  if (checks.state === "failure") return "Failure";
  if (checks.state === "pending") return "Pending";
  return "No checks";
}

function reviewPart(decision: PrFacts["reviewDecision"]): string {
  if (decision === "approved") return "Approved";
  if (decision === "changes-requested") return "Changes requested";
  if (decision === "review-required") return "Review required";
  return "No review";
}

function commentsPart(count: number): string {
  return count === 1 ? "1 comment" : `${count} comments`;
}

/** Compact single-line label for a live PR facts row. */
export function prFactsChipLabel(facts: PrFacts): string {
  return [
    draftPart(facts.isDraft),
    checksPart(facts.checks),
    reviewPart(facts.reviewDecision),
    commentsPart(facts.commentCount),
  ].join(" · ");
}

function prFactsChipVariant(
  facts: PrFacts,
): NonNullable<BadgeProps["variant"]> {
  if (facts.isDraft) return "warn";
  if (
    facts.checks.state === "failure" ||
    facts.reviewDecision === "changes-requested"
  ) {
    return "blocked";
  }
  if (
    facts.checks.state === "pending" ||
    facts.reviewDecision === "review-required"
  ) {
    return "current";
  }
  return "done";
}

/**
 * Resolve the compact PR chip for a Story row.
 * No `prUrl`, and a view that has not fetched yet, stay hidden — never a
 * placeholder. A Story with a `prUrl` never disappears into the no-PR look:
 * `not-found` and a failed query both surface as unavailable.
 */
export function resolvePrChip(args: {
  prUrl: string | undefined;
  entry: PrFacts | PrUnavailable | undefined;
  queryFailed: boolean;
  hasData: boolean;
}): PrChipModel {
  if (!args.prUrl) return { kind: "hidden" };
  if (args.queryFailed) {
    return {
      kind: "chip",
      label: UNAVAILABLE_LABEL,
      variant: "secondary",
    };
  }
  if (!args.hasData) return { kind: "hidden" };
  if (!args.entry || isPrUnavailable(args.entry)) {
    return {
      kind: "chip",
      label: UNAVAILABLE_LABEL,
      variant: "secondary",
    };
  }
  return {
    kind: "chip",
    label: prFactsChipLabel(args.entry),
    variant: prFactsChipVariant(args.entry),
  };
}

/** Compact PR state chip for tree / flow Story rows. */
export function PrChip({
  model,
  className,
}: {
  model: PrChipModel;
  className?: string;
}) {
  if (model.kind === "hidden") return null;
  return (
    <Badge
      variant={model.variant}
      className={className}
      data-testid="pr-chip"
      title={model.label}
    >
      {model.label}
    </Badge>
  );
}
