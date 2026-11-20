import { useMemo } from "react";
import type { IssueDetail } from "@server/schemas";
import { concludedPlanningOutline } from "@server/services/concluded-outline";
import { Badge } from "@/components/ui/badge";
import { useIssuesWithArchived } from "../hooks/use-issues-with-archived";
import { IssueLink } from "./issue-link";
import { DetailEyebrow } from "./detail-section";

type IdeaDetail = Extract<IssueDetail, { kind: "idea" }>;

/** Outline the archived Idea's planner continued onto, when conclude recorded one. */
export function useConcludedPlanningOutline(
  idea: IdeaDetail | undefined,
): { id: string; title: string } | undefined {
  const { data } = useIssuesWithArchived(Boolean(idea?.archived));
  const issues = data?.issues;
  return useMemo(() => {
    if (!idea?.archived || !issues) return undefined;
    return concludedPlanningOutline(issues, idea);
  }, [idea, issues]);
}

export function PlanningReadOnlyBadge() {
  return (
    <Badge
      variant="secondary"
      className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em]"
      data-testid="planning-read-only"
    >
      Read-only
    </Badge>
  );
}

export function PlanningConcludedBanner({
  outlineId,
  outlineTitle,
}: {
  outlineId: string;
  outlineTitle: string;
}) {
  return (
    <section
      data-testid="planning-concluded-banner"
      className="border-b border-border px-4 py-3"
    >
      <DetailEyebrow className="mb-1.5">Planning concluded</DetailEyebrow>
      <p className="text-sm leading-relaxed text-muted-foreground">
        This Idea is archived. The planner session is read-only history here
        — continue on{" "}
        <IssueLink
          id={outlineId}
          channel="planning"
          className="text-primary hover:underline"
        >
          {outlineTitle}
        </IssueLink>{" "}
        (Planning tab).
      </p>
    </section>
  );
}
