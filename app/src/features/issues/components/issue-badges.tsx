import { CircleSlash, User } from "lucide-react";
import type { IssueRecord } from "@server/schemas";
import { assigneeOf } from "@server/assignee";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";
import { ReviewBadge } from "./review-badge";

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
  const review =
    !compact && issue.kind === "story" ? issue.review : undefined;
  const noDiff =
    !compact && issue.kind === "task" ? issue.noDiff : undefined;

  if (!assignee && !review && !noDiff) return null;
  return (
    <span className={cn("flex items-center gap-1.5", className)}>
      {assignee ? (
        <Badge variant="secondary" className="gap-1">
          <User className="h-3 w-3" />
          {assignee}
        </Badge>
      ) : null}
      {review ? <ReviewBadge status={review} /> : null}
      {noDiff ? (
        <Badge variant="secondary" className="gap-1" title="No source-controlled implementor changes">
          <CircleSlash className="h-3 w-3" />
          no diff
        </Badge>
      ) : null}
    </span>
  );
}
