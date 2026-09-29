import { useState } from "react";
import { Bot, ChevronRight, Circle } from "lucide-react";
import type { ReactNode } from "react";
import type { CommentMessage } from "@server/schemas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { roleFamilyCaption } from "@/features/pipeline/role-family";
import { cn } from "@/lib/utils/cn";
import { type CommentThread as CommentThreadData } from "../../lib/comment-threads";
import { commentCountLabel } from "../../lib/comments";
import { Markdown } from "../markdown";
import {
  CommentAnchorMeta,
  CommentAnchorSnippet,
} from "./comment-anchor-context";
import { isHumanRole } from "./message";

export function CommentThread({
  thread,
  onReply,
  issueId,
  replySlot,
  showAnchorContext = false,
  onSeeInDiff,
  inline = false,
  onResolve,
  onUnresolve,
  resolvePending = false,
}: {
  thread: CommentThreadData;
  onReply: () => void;
  issueId?: string;
  replySlot?: ReactNode;
  showAnchorContext?: boolean;
  onSeeInDiff?: () => void;
  /** Inside a file diff: drop path and line, and collapse when resolved. */
  inline?: boolean;
  onResolve?: () => void;
  onUnresolve?: () => void;
  resolvePending?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const outdated = thread.root.outdated === true;
  const comments = [thread.root, ...thread.replies];
  const anchor = thread.root.anchor;
  const resolved = thread.state === "resolved";
  const collapsed = inline && resolved && !expanded;
  const showAnchorHeader =
    anchor != null && (!inline || outdated || onSeeInDiff != null);

  return (
    <article
      data-thread-root={thread.root.id}
      data-thread-state={thread.state}
      data-outdated={outdated ? "" : undefined}
      data-collapsed={collapsed ? "" : undefined}
      className={cn(
        "flex flex-col rounded-md border border-border bg-card",
        collapsed ? "px-3 py-1.5" : "px-3 py-2",
        outdated && "opacity-70",
      )}
    >
      {collapsed ? null : (
        <>
          {showAnchorHeader && anchor ? (
            <CommentAnchorMeta
              anchor={anchor}
              outdated={outdated}
              showLocation={!inline}
              onSeeInDiff={onSeeInDiff}
            />
          ) : null}
          {showAnchorContext && issueId && anchor ? (
            <CommentAnchorSnippet issueId={issueId} anchor={anchor} />
          ) : null}

          {comments.map((comment) => (
            <ThreadComment
              key={comment.id}
              comment={comment}
              issueId={issueId}
            />
          ))}

          <div className="flex flex-wrap items-center gap-1 pt-1">
            {replySlot ?? (
              <Button type="button" variant="ghost" size="sm" onClick={onReply}>
                Reply
              </Button>
            )}
            {onResolve && !resolved ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onResolve}
                disabled={resolvePending}
                data-testid="thread-resolve"
              >
                Resolve
              </Button>
            ) : null}
          </div>
        </>
      )}

      {inline && resolved ? (
        <ResolvedThreadBar
          count={comments.length}
          expanded={expanded}
          pending={resolvePending}
          onToggle={() => setExpanded((open) => !open)}
          onUnresolve={onUnresolve}
        />
      ) : null}
    </article>
  );
}

function ResolvedThreadBar({
  count,
  expanded,
  pending,
  onToggle,
  onUnresolve,
}: {
  count: number;
  expanded: boolean;
  pending: boolean;
  onToggle: () => void;
  onUnresolve?: () => void;
}) {
  const toggleLabel = expanded ? "Collapse thread" : "Expand thread";
  return (
    <div
      data-testid="thread-resolved-bar"
      className="flex flex-wrap items-center gap-x-2 gap-y-1"
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto min-w-0 justify-start px-1.5 py-1 text-left font-normal [&_svg]:size-3.5"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <Circle className="text-muted-foreground" aria-hidden />
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {commentCountLabel(count)}
        </span>
        <Badge variant="done" className="uppercase tracking-[0.08em]">
          Resolved
        </Badge>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onUnresolve}
        disabled={pending || !onUnresolve}
        data-testid="thread-unresolve"
      >
        Unresolve
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="ml-auto"
        aria-label={toggleLabel}
        onClick={onToggle}
      >
        <ChevronRight
          className={cn("transition-transform", expanded && "rotate-90")}
          aria-hidden
        />
      </Button>
    </div>
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
