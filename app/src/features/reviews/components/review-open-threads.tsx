import { ChevronRight } from "lucide-react";
import type { ReviewOpenRound } from "../lib/review-submission-ui";
import { openThreadsHeadline } from "../lib/review-submission-ui";
import { SETTINGS_HEADING_CLASS } from "@/features/issues/components/detail-section";
import { isLineAnchor } from "@/features/issues/lib/comment-anchor";
import { anchorLineRange } from "@/features/issues/lib/comment-anchor-snippet";
import type { CommentThread } from "@/features/issues/lib/comment-threads";

function threadLocation(thread: CommentThread): string {
  const anchor = thread.root.anchor;
  if (!anchor) return "Story comment";
  if (!isLineAnchor(anchor)) return anchor.path;
  const { start, end } = anchorLineRange(anchor);
  const lines = start === end ? String(end) : `${start}-${end}`;
  return `${anchor.path}:${lines}`;
}

function threadExcerpt(body: string): string {
  const line = body
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  return line ?? "";
}

/** Open threads from submissions that are not done, grouped by round. */
export function ReviewOpenThreads({
  rounds,
  threads,
  threadsReady,
  onOpenThread,
}: {
  rounds: readonly ReviewOpenRound[];
  threads: readonly CommentThread[];
  threadsReady: boolean;
  onOpenThread?: (thread: CommentThread) => void;
}) {
  if (rounds.length === 0) return null;
  const byId = new Map(threads.map((thread) => [thread.root.id, thread]));
  const count = rounds.reduce((sum, round) => sum + round.threadIds.length, 0);
  const showRounds = rounds.length > 1;

  return (
    <details
      data-testid="review-open-threads"
      className="group mt-2 rounded-md border border-border bg-card"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 px-3 marker:content-none [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground motion-safe:transition-transform group-open:rotate-90"
        />
        <span className="text-sm text-foreground">{openThreadsHeadline(count)}</span>
      </summary>
      {threadsReady ? (
        <div>
          {rounds.map((round) => (
            <section key={round.submissionId} aria-label={`Round ${round.round}`}>
              {showRounds ? (
                <p className={`${SETTINGS_HEADING_CLASS} border-t border-border px-3 pt-2`}>
                  Round {round.round}
                </p>
              ) : null}
              <ul className="m-0 list-none border-t border-border p-0">
                {round.threadIds.map((threadId) => {
                  const thread = byId.get(threadId);
                  const excerpt = thread ? threadExcerpt(thread.root.body) : "";
                  return (
                    <li key={`${round.submissionId}:${threadId}`} className="border-t border-border first:border-t-0">
                      <button
                        type="button"
                        data-testid="review-open-thread"
                        data-thread-id={threadId}
                        disabled={!thread}
                        className="flex w-full min-w-0 flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-muted/40 touch:min-h-11 disabled:hover:bg-transparent"
                        onClick={() => {
                          if (thread) onOpenThread?.(thread);
                        }}
                      >
                        <span className="max-w-full break-all font-mono text-xs text-[hsl(var(--current))]">
                          {thread ? threadLocation(thread) : threadId}
                        </span>
                        {excerpt ? (
                          <span className="line-clamp-2 text-sm text-muted-foreground">
                            {excerpt}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <p className="border-t border-border px-3 py-2 text-sm text-muted-foreground">
          Loading threads…
        </p>
      )}
    </details>
  );
}
