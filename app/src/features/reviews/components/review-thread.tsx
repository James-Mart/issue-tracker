import { useState, type ReactNode } from "react";
import type { CommentThread as CommentThreadData } from "@/features/issues/lib/comment-threads";
import {
  useEditComment,
  usePostComment,
  usePostThreadEvent,
} from "@/features/issues/api/mutations";
import { replyDraftKey } from "@/features/reviews/lib/review-draft-key";
import { CommentThread } from "@/features/issues/components/comments/comment-thread";
import { threadStateActions } from "@/features/issues/lib/comment-threads";
import { SETTINGS_HEADING_CLASS } from "@/features/issues/components/detail-section";
import { ReviewComposer } from "./review-composer";

const COMPOSER_ROLE = "human";

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
  const edit = useEditComment(storyId);
  const events = usePostThreadEvent(storyId);
  const [replying, setReplying] = useState(false);

  const sendReply = (body: string) => {
    post({ role: COMPOSER_ROLE, body, replyTo: thread.root.id });
    setReplying(false);
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
          <div data-testid="review-thread-reply" data-thread-id={thread.root.id}>
            <ReviewComposer
              draftKey={replyDraftKey(storyId, thread.root.id)}
              placeholder="Reply"
              submitLabel="Send"
              onSubmit={sendReply}
              onCancel={() => setReplying(false)}
            />
          </div>
        ) : undefined
      }
      resolvePending={events.isPending}
      onEdit={async (commentId, body) => {
        await edit.mutateAsync({ commentId, body });
      }}
      {...threadStateActions(thread, (event) =>
        events.mutate({ threadId: thread.root.id, event }),
      )}
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
