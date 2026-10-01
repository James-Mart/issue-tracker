import { useState } from "react";
import { Bot, ChevronRight, Circle, HelpCircle, User } from "lucide-react";
import type { ReactNode } from "react";
import { isLineAnchor } from "../../lib/comment-anchor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import {
  formatAnchorLineLabel,
  isQuestionThread,
  type CommentThread as CommentThreadData,
} from "../../lib/comment-threads";
import type { ThreadMessage } from "../../lib/comment-outbox";
import { commentCountLabel } from "../../lib/comments";
import {
  CommentAnchorMeta,
  CommentAnchorSnippet,
} from "./comment-anchor-context";
import { EditableCommentBody } from "./comment-edit";
import { CommentSendingMark } from "./comment-delivery";
import {
  CommentHeader,
  commentHeaderLabels,
  formatCommentTime,
  isHumanRole,
} from "./message";
import {
  QuestionResearcherStatus,
  ResearcherRetryButton,
} from "./question-researcher-status";
import { ThreadLinkedTaskChip } from "./thread-linked-task-chip";

export function CommentThread({
  thread,
  onReply,
  issueId,
  replySlot,
  showAnchorContext = false,
  onSeeInDiff,
  inline = false,
  collapse,
  onResolve,
  onUnresolve,
  onDismiss,
  onReopen,
  onConvert,
  resolvePending = false,
  onEdit,
}: {
  thread: CommentThreadData;
  /** Absent on a flat Story note: no Reply control. */
  onReply?: () => void;
  issueId?: string;
  replySlot?: ReactNode;
  showAnchorContext?: boolean;
  onSeeInDiff?: () => void;
  /** Inside a file diff: drop path and line, and collapse when resolved. */
  inline?: boolean;
  /**
   * `resolved`: Conversation timeline, collapse when resolved and keep the anchor header.
   * `outdated`: Diff Outdated group, collapse to a bar carrying the line.
   */
  collapse?: "resolved" | "outdated";
  onResolve?: () => void;
  onUnresolve?: () => void;
  onDismiss?: () => void;
  onReopen?: () => void;
  onConvert?: () => void;
  resolvePending?: boolean;
  onEdit?: (commentId: string, body: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const outdated = thread.root.outdated === true;
  const anchor = thread.root.anchor;
  const question = isQuestionThread(thread);
  const resolved = thread.state === "resolved";
  const dismissed = thread.state === "dismissed";
  // The server has no thread to reply to or act on until the root is stored.
  const stored = thread.root.delivery === undefined;
  const reply = stored && replySlot == null ? onReply : undefined;
  const showResolveButton = stored && !question && onResolve != null && !resolved;
  const outdatedBar = collapse === "outdated" && outdated;
  const collapses =
    outdatedBar ||
    ((inline || collapse === "resolved") && resolved) ||
    dismissed;
  const collapsed = collapses && !expanded;
  const showAnchorHeader =
    anchor != null &&
    !outdatedBar &&
    (!inline || outdated || onSeeInDiff != null);
  const showQuestionBadge = question && !dismissed;
  const statusBadgeHost = statusBadgePlacement({
    showAnchorHeader,
    collapsed,
    showQuestionBadge,
    dismissed,
  });

  return (
    <article
      data-thread-root={thread.root.id}
      data-thread-kind={question ? "question" : "review"}
      data-thread-state={thread.state}
      data-ready-to-task={thread.readyToTask ? "" : undefined}
      data-outdated={outdated ? "" : undefined}
      data-collapsed={collapsed ? "" : undefined}
      className={cn(
        "flex min-w-0 flex-col rounded-md border border-border bg-card",
        collapsed ? "px-3 py-1.5" : "px-3 py-2",
        outdated && !outdatedBar && "opacity-70",
      )}
    >
      {showAnchorHeader && anchor ? (
        <CommentAnchorMeta
          anchor={anchor}
          outdated={outdated}
          showLocation={!inline}
          onSeeInDiff={onSeeInDiff}
          badges={
            statusBadgeHost === "anchor" ? (
              <ThreadStatusBadges
                question={showQuestionBadge}
                dismissed={dismissed}
              />
            ) : null
          }
        />
      ) : null}
      {thread.linkedTaskId && !question && (!collapsed || showAnchorHeader) ? (
        <ThreadChipRow taskId={thread.linkedTaskId} />
      ) : null}
      {collapsed ? null : (
        <>
          {showAnchorContext && issueId && anchor ? (
            <CommentAnchorSnippet issueId={issueId} anchor={anchor} />
          ) : null}

          <ThreadComment
            comment={thread.root}
            issueId={issueId}
            onEdit={onEdit}
            badges={
              statusBadgeHost === "root" ? (
                <ThreadStatusBadges
                  question={showQuestionBadge}
                  dismissed={dismissed}
                />
              ) : null
            }
          />
          {thread.replies.map((comment) => (
            <ThreadComment
              key={comment.id}
              comment={comment}
              issueId={issueId}
              onEdit={onEdit}
            />
          ))}

          {thread.researcherRun && issueId ? (
            <QuestionResearcherStatus run={thread.researcherRun} />
          ) : null}

          {thread.converted ? (
            <ThreadConvertedEvent converted={thread.converted} />
          ) : null}

          {replySlot != null || reply != null || showResolveButton ? (
          <div className="flex flex-col gap-2 pt-1">
            {replySlot}
            {reply != null || showResolveButton ? (
              <div className="flex flex-wrap items-center gap-1">
                {reply != null ? (
                  <Button type="button" variant="ghost" size="sm" onClick={reply}>
                    Reply
                  </Button>
                ) : null}
                {showResolveButton ? (
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
            ) : null}
          </div>
          ) : null}
          {stored && question && !dismissed ? (
            <QuestionCardFooter
              issueId={issueId}
              threadId={thread.root.id}
              failed={thread.researcherRun?.status === "failed"}
              pending={resolvePending}
              onDismiss={onDismiss}
              onConvert={onConvert}
            />
          ) : null}
        </>
      )}

      {collapses ? (
        <CollapsedThreadBar
          count={1 + thread.replies.length}
          lineLabel={
            outdatedBar && anchor && isLineAnchor(anchor)
              ? formatAnchorLineLabel(anchor)
              : undefined
          }
          question={question}
          resolved={resolved}
          dismissed={dismissed}
          showDismissedBadge={statusBadgeHost === "bar"}
          expanded={expanded}
          pending={resolvePending}
          onToggle={() => setExpanded((open) => !open)}
          onUnresolve={onUnresolve}
          onReopen={onReopen}
        />
      ) : null}
    </article>
  );
}

function QuestionCardFooter({
  issueId,
  threadId,
  failed,
  pending,
  onDismiss,
  onConvert,
}: {
  issueId?: string;
  threadId: string;
  failed: boolean;
  pending: boolean;
  onDismiss?: () => void;
  onConvert?: () => void;
}) {
  const showRetry = failed && issueId != null;
  if (!showRetry && !onDismiss && !onConvert) return null;
  return (
    <footer
      data-testid="question-card-footer"
      className="mt-2 flex flex-wrap items-center gap-1 border-t border-border pt-2"
    >
      {showRetry ? (
        <ResearcherRetryButton storyId={issueId} threadId={threadId} />
      ) : null}
      {onDismiss ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDismiss}
          disabled={pending}
          data-testid="thread-dismiss"
        >
          Dismiss question
        </Button>
      ) : null}
      {onConvert ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onConvert}
          disabled={pending}
          data-testid="thread-convert"
        >
          Convert to review comment
        </Button>
      ) : null}
    </footer>
  );
}

function ThreadConvertedEvent({
  converted,
}: {
  converted: NonNullable<CommentThreadData["converted"]>;
}) {
  const name = converted.by.name ?? converted.by.role;
  const time = formatCommentTime(converted.at);
  return (
    <section
      data-testid="thread-converted"
      className="flex flex-col gap-0.5 border-b border-border py-2 text-[11px] text-muted-foreground"
    >
      <p className="flex items-start gap-2">
        <User className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          <span className="font-medium text-foreground/80">{name}</span>
          {" converted this question to a review comment"}
        </span>
      </p>
      {time ? (
        <time dateTime={converted.at} className="pl-5">
          {time}
        </time>
      ) : null}
    </section>
  );
}

function ThreadChipRow({ taskId }: { taskId: string }) {
  return (
    <div className="flex w-full flex-wrap items-center justify-end gap-1 pb-1">
      <ThreadLinkedTaskChip taskId={taskId} />
    </div>
  );
}

function CollapsedThreadBar({
  count,
  lineLabel,
  question,
  resolved,
  dismissed,
  showDismissedBadge,
  expanded,
  pending,
  onToggle,
  onUnresolve,
  onReopen,
}: {
  count: number;
  lineLabel?: string;
  question: boolean;
  resolved: boolean;
  dismissed: boolean;
  showDismissedBadge: boolean;
  expanded: boolean;
  pending: boolean;
  onToggle: () => void;
  onUnresolve?: () => void;
  onReopen?: () => void;
}) {
  const toggleLabel = expanded ? "Collapse thread" : "Expand thread";
  return (
    <div
      data-testid="thread-collapsed-bar"
      className="flex flex-wrap items-center gap-x-2 gap-y-1"
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto min-w-0 flex-1 flex-wrap justify-start whitespace-normal px-1.5 py-1 text-left font-normal [&_svg]:size-3.5"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        {question ? (
          <HelpCircle className="text-muted-foreground" aria-hidden />
        ) : (
          <Circle className="text-muted-foreground" aria-hidden />
        )}
        <span className="whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground">
          {lineLabel ? `${lineLabel} · ` : null}
          {commentCountLabel(count)}
        </span>
        {resolved ? (
          <Badge variant="done" className="uppercase tracking-[0.08em]">
            Resolved
          </Badge>
        ) : null}
        {showDismissedBadge ? (
          <ThreadStatusBadges question={false} dismissed />
        ) : null}
      </Button>
      {resolved ? (
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
      ) : null}
      {dismissed ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onReopen}
          disabled={pending || !onReopen}
          data-testid="thread-reopen"
        >
          Reopen
        </Button>
      ) : null}
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

function ThreadStatusBadges({
  question,
  dismissed,
}: {
  question: boolean;
  dismissed: boolean;
}) {
  if (!question && !dismissed) return null;
  return (
    <>
      {question ? (
        <Badge
          variant="secondary"
          data-testid="thread-question-label"
          className="shrink-0 uppercase tracking-[0.08em]"
        >
          Question
        </Badge>
      ) : null}
      {dismissed ? (
        <Badge
          variant="secondary"
          data-testid="thread-dismissed-label"
          className="shrink-0 uppercase tracking-[0.08em]"
        >
          Dismissed
        </Badge>
      ) : null}
    </>
  );
}

function statusBadgePlacement({
  showAnchorHeader,
  collapsed,
  showQuestionBadge,
  dismissed,
}: {
  showAnchorHeader: boolean;
  collapsed: boolean;
  showQuestionBadge: boolean;
  dismissed: boolean;
}): "anchor" | "root" | "bar" | "none" {
  if (!showQuestionBadge && !dismissed) return "none";
  if (showAnchorHeader) return "anchor";
  if (collapsed) return dismissed ? "bar" : "none";
  return "root";
}

function ThreadComment({
  comment,
  issueId,
  onEdit,
  badges,
}: {
  comment: ThreadMessage;
  issueId?: string;
  onEdit?: (commentId: string, body: string) => Promise<void>;
  badges?: ReactNode;
}) {
  const { author, roleBadge } = commentHeaderLabels(comment.role, comment.name);
  return (
    <section
      data-comment-id={comment.id}
      data-delivery={comment.delivery?.status}
      className="flex flex-col gap-1 border-b border-border py-2 last:border-b-0"
    >
      <CommentHeader
        author={author}
        roleBadge={roleBadge}
        at={comment.at}
        leading={
          isHumanRole(comment.role) ? undefined : (
            <Bot className="h-3.5 w-3.5 shrink-0" aria-hidden />
          )
        }
        extra={
          <>
            {badges}
            {comment.newSession ? (
              <Badge
                variant="current"
                data-testid="researcher-new-session"
                className="uppercase tracking-[0.08em]"
              >
                New session
              </Badge>
            ) : null}
          </>
        }
        status={<CommentSendingMark message={comment} />}
      />
      <EditableCommentBody comment={comment} issueId={issueId} onEdit={onEdit} />
    </section>
  );
}
