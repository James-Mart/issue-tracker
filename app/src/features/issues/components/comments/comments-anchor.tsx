import { MessageSquare } from "lucide-react";
import type { IssueDetail } from "@server/schemas";
import { hasAttention } from "@server/kind";
import { cn } from "@/lib/utils/cn";
import { useCommentsQuery } from "../../api/queries";
import { supportsComments } from "../../lib/comments";

function commentCountLabel(count: number): string {
  return count === 1 ? "1 comment" : `${count} comments`;
}

/** Header link beside the issue id: comment count + scroll target for the thread. */
export function CommentsAnchorLink({
  issue,
  commentCount,
}: {
  issue: IssueDetail;
  commentCount: number;
}) {
  if (!supportsComments(issue.kind)) return null;

  const flagged = hasAttention(issue) && issue.needsAttention;
  const label = commentCountLabel(commentCount);

  return (
    <a
      href="#comments"
      className={cn(
        "inline-flex shrink-0 items-center gap-1 font-mono text-xs tabular-nums no-underline hover:underline hover:underline-offset-[3px]",
        flagged
          ? "[color:hsl(var(--warning))]"
          : "text-muted-foreground hover:text-foreground",
      )}
      title={
        flagged
          ? (issue.attentionReason ?? "Needs attention — jump to comments")
          : `Jump to ${label}`
      }
      aria-label={flagged ? `${label} — needs attention` : `Jump to ${label}`}
    >
      <MessageSquare className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{commentCount}</span>
    </a>
  );
}

export function CommentsAnchor({ issue }: { issue: IssueDetail }) {
  if (!supportsComments(issue.kind)) return null;
  return <CommentsAnchorWithQuery issue={issue} />;
}

function CommentsAnchorWithQuery({ issue }: { issue: IssueDetail }) {
  const { data } = useCommentsQuery(issue.id);
  const commentCount = data?.messages.length ?? 0;
  return <CommentsAnchorLink issue={issue} commentCount={commentCount} />;
}
