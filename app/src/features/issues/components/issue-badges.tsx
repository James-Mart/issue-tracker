import { AlertTriangle, CircleSlash, User } from "lucide-react";
import type { IssueRecord } from "@server/schemas";
import { assigneeOf } from "@server/assignee";
import { hasAttention } from "@server/kind";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";
import { SpecReviewBadge } from "./spec-review-badge";

export function IssueBadges({
  issue,
  compact = false,
  className,
}: {
  issue: IssueRecord;
  compact?: boolean;
  className?: string;
}) {
  const assignee = assigneeOf(issue);
  const needsAttention = hasAttention(issue) ? issue.needsAttention : false;
  const attentionReason = hasAttention(issue) ? issue.attentionReason : null;
  const specReview =
    !compact && issue.kind === "story" ? issue.specReview : undefined;
  const noDiff =
    !compact && issue.kind === "task" ? issue.noDiff : undefined;

  if (!assignee && !needsAttention && !specReview && !noDiff) return null;
  return (
    <span className={cn("flex items-center gap-1.5", className)}>
      {needsAttention ? (
        <Badge
          variant="warn"
          className="gap-1"
          title={attentionReason ?? "needs attention"}
        >
          <AlertTriangle className="h-3 w-3" />
          {compact ? "attention" : (attentionReason ?? "needs attention")}
        </Badge>
      ) : null}
      {assignee ? (
        <Badge variant="secondary" className="gap-1">
          <User className="h-3 w-3" />
          {assignee}
        </Badge>
      ) : null}
      {specReview ? <SpecReviewBadge status={specReview} /> : null}
      {noDiff ? (
        <Badge variant="secondary" className="gap-1" title="No source-controlled implementor changes">
          <CircleSlash className="h-3 w-3" />
          no diff
        </Badge>
      ) : null}
    </span>
  );
}
