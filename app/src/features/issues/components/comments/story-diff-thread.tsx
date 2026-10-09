import { createContext, useContext, type ReactNode } from "react";
import { usePostThreadEvent } from "../../api/mutations";
import {
  threadStateActions,
  type CommentThread as CommentThreadData,
} from "../../lib/comment-threads";
import type { ThreadMessage } from "../../lib/comment-outbox";
import { CommentThread } from "./comment-thread";

const ResolveThreadsContext = createContext(false);

export function ResolveThreadsProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  return (
    <ResolveThreadsContext.Provider value={enabled}>
      {children}
    </ResolveThreadsContext.Provider>
  );
}

export function useResolveThreads(): boolean {
  return useContext(ResolveThreadsContext);
}

/** Story diff thread: resolve and unresolve through the human event route. */
export function StoryDiffThread({
  thread,
  issueId,
  onReply,
  replySlot,
  onQuote,
  quoteSlot,
  quoteCommentId,
}: {
  thread: CommentThreadData;
  issueId: string;
  onReply: () => void;
  replySlot?: ReactNode;
  onQuote?: (comment: ThreadMessage) => void;
  quoteSlot?: ReactNode;
  quoteCommentId?: string;
}) {
  const post = usePostThreadEvent(issueId);
  return (
    <CommentThread
      thread={thread}
      issueId={issueId}
      onReply={onReply}
      replySlot={replySlot}
      onQuote={onQuote}
      quoteSlot={quoteSlot}
      quoteCommentId={quoteCommentId}
      inline
      resolvePending={post.isPending}
      {...threadStateActions(thread, (event) =>
        post.mutate({ threadId: thread.root.id, event }),
      )}
    />
  );
}
