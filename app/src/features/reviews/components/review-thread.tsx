import { useState, type KeyboardEvent, type ReactNode } from "react";
import { Send } from "lucide-react";
import type { CommentThread as CommentThreadData } from "@/features/issues/lib/comment-threads";
import { usePostComment, usePostThreadEvent } from "@/features/issues/api/mutations";
import { CommentThread } from "@/features/issues/components/comments/comment-thread";
import { SETTINGS_HEADING_CLASS } from "@/features/issues/components/detail-section";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const COMPOSER_ROLE = "human";

function ReplyComposer({
  threadId,
  draft,
  pending,
  onDraftChange,
  onSend,
}: {
  threadId: string;
  draft: string;
  pending: boolean;
  onDraftChange: (value: string) => void;
  onSend: () => void;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  };

  return (
    <div
      data-testid="review-thread-reply"
      data-thread-id={threadId}
      className="flex min-w-0 items-end gap-2"
    >
      <Textarea
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Reply"
        title="Enter to send, Shift+Enter for a newline"
        aria-label="Reply"
        className="min-h-[40px] min-w-0 flex-1 resize-none touch:min-h-[44px]"
      />
      <Button
        size="icon"
        variant="primary"
        className="h-11 w-11 shrink-0"
        onClick={onSend}
        disabled={pending || !draft.trim()}
        title="Send"
        aria-label="Send"
      >
        <Send className="h-4 w-4" />
      </Button>
    </div>
  );
}

/** Story thread on the review workbench: reply, resolve, and unresolve. */
export function ReviewThread({
  thread,
  storyId,
  inline = false,
  showAnchorContext = false,
  collapse,
  onSeeInDiff,
}: {
  thread: CommentThreadData;
  storyId: string;
  inline?: boolean;
  showAnchorContext?: boolean;
  collapse?: "resolved" | "outdated";
  onSeeInDiff?: () => void;
}) {
  const post = usePostComment(storyId);
  const events = usePostThreadEvent(storyId);
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState("");

  const sendReply = () => {
    const body = draft.trim();
    if (!body || post.isPending) return;
    post.mutate(
      { role: COMPOSER_ROLE, body, replyTo: thread.root.id },
      {
        onSuccess: () => {
          setDraft("");
          setReplying(false);
        },
      },
    );
  };

  return (
    <CommentThread
      thread={thread}
      issueId={storyId}
      inline={inline}
      showAnchorContext={showAnchorContext}
      collapse={collapse}
      onSeeInDiff={onSeeInDiff}
      onReply={() => setReplying(true)}
      replySlot={
        replying ? (
          <ReplyComposer
            threadId={thread.root.id}
            draft={draft}
            pending={post.isPending}
            onDraftChange={setDraft}
            onSend={sendReply}
          />
        ) : undefined
      }
      resolvePending={events.isPending}
      onResolve={() =>
        events.mutate({ threadId: thread.root.id, event: "resolved" })
      }
      onUnresolve={() =>
        events.mutate({ threadId: thread.root.id, event: "unresolved" })
      }
    />
  );
}

export function ReviewLineThreads({
  threads,
  storyId,
  composer,
}: {
  threads: CommentThreadData[];
  storyId: string;
  /** New-thread composer open on this line. */
  composer?: ReactNode;
}) {
  if (threads.length === 0 && composer == null) return null;
  return (
    // Annotations slot into the diff's shadow tree and would inherit its monospace code font.
    <div
      data-testid="review-line-threads"
      className="flex flex-col gap-2 px-3 py-2 font-sans"
    >
      {threads.map((thread) => (
        <ReviewThread key={thread.root.id} thread={thread} storyId={storyId} inline />
      ))}
      {composer}
    </div>
  );
}

/** All changes: threads whose anchor drifted, kept in their file card below the code. */
export function ReviewOutdatedThreads({
  threads,
  storyId,
}: {
  threads: CommentThreadData[];
  storyId: string;
}) {
  if (threads.length === 0) return null;
  return (
    <section
      data-testid="review-outdated-threads"
      aria-label="Outdated threads"
      className="flex flex-col gap-2 border-t border-border px-3 py-2"
    >
      <p className={SETTINGS_HEADING_CLASS}>Outdated</p>
      {threads.map((thread) => (
        <ReviewThread
          key={thread.root.id}
          thread={thread}
          storyId={storyId}
          inline
          showAnchorContext
          collapse="outdated"
        />
      ))}
    </section>
  );
}
