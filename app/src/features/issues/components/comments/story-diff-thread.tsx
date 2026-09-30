import { createContext, useContext, type ReactNode } from "react";
import { usePostThreadEvent } from "../../api/mutations";
import {
  threadStateActions,
  type CommentThread as CommentThreadData,
} from "../../lib/comment-threads";
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
}: {
  thread: CommentThreadData;
  issueId: string;
  onReply: () => void;
  replySlot?: ReactNode;
}) {
  const post = usePostThreadEvent(issueId);
  return (
    <CommentThread
      thread={thread}
      issueId={issueId}
      onReply={onReply}
      replySlot={replySlot}
      inline
      resolvePending={post.isPending}
      {...threadStateActions(thread, (event) =>
        post.mutate({ threadId: thread.root.id, event }),
      )}
    />
  );
}
