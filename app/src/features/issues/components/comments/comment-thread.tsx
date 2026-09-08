import { Bot } from "lucide-react";
import type { CommentMessage } from "@server/schemas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { roleFamilyCaption } from "@/features/pipeline/role-family";
import { cn } from "@/lib/utils/cn";
import {
  formatCommentAnchor,
  type CommentThread as CommentThreadData,
} from "../../lib/comment-threads";
import { Markdown } from "../markdown";
import { isHumanRole } from "./message";

export function CommentThread({
  thread,
  onReply,
  issueId,
}: {
  thread: CommentThreadData;
  onReply: () => void;
  issueId?: string;
}) {
  const outdated = thread.root.outdated === true;
  const comments = [thread.root, ...thread.replies];

  return (
    <article
      data-thread-root={thread.root.id}
      data-outdated={outdated ? "" : undefined}
      className={cn(
        "flex flex-col rounded-md border border-border bg-card px-3 py-2",
        outdated && "opacity-70",
      )}
    >
      {thread.root.anchor ? (
        <div className="flex flex-wrap items-center gap-2 pb-1.5">
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {formatCommentAnchor(thread.root.anchor)}
          </span>
          {outdated ? (
            <Badge variant="warn" className="uppercase tracking-[0.08em]">
              outdated
            </Badge>
          ) : null}
        </div>
      ) : null}

      {comments.map((comment) => (
        <ThreadComment
          key={comment.id}
          comment={comment}
          issueId={issueId}
        />
      ))}

      <div className="pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={onReply}>
          Reply
        </Button>
      </div>
    </article>
  );
}

function ThreadComment({
  comment,
  issueId,
}: {
  comment: CommentMessage;
  issueId?: string;
}) {
  return (
    <section
      data-comment-id={comment.id}
      className="flex flex-col gap-1 border-b border-border py-2 last:border-b-0"
    >
      <ThreadAuthorship comment={comment} />
      <Markdown issueId={issueId}>{comment.body}</Markdown>
    </section>
  );
}

function ThreadAuthorship({ comment }: { comment: CommentMessage }) {
  const time = formatTime(comment.at);

  if (isHumanRole(comment.role)) {
    return (
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground/80">
          {comment.name ?? comment.role}
        </span>
        {time ? <time dateTime={comment.at}>{time}</time> : null}
      </header>
    );
  }

  return (
    <header className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
      <Bot className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="font-medium text-foreground/80">
        {roleFamilyCaption(comment.role).caption}
      </span>
      {time ? <time dateTime={comment.at}>{time}</time> : null}
    </header>
  );
}

function formatTime(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
