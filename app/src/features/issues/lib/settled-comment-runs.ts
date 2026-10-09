import {
  isPlainNote,
  isQuestionThread,
  type CommentThread,
} from "./comment-threads";

/** A settled item on the story comments list: a resolved review thread or a dismissed question. */
type SettledCommentKind = "resolved" | "dismissed";

export type CommentListEntry =
  | { kind: "thread"; thread: CommentThread }
  | {
      kind: "run";
      id: string;
      title: string;
      threads: [CommentThread, CommentThread, ...CommentThread[]];
    };

function settledCommentKind(thread: CommentThread): SettledCommentKind | null {
  if (isPlainNote(thread)) return null;
  if (isQuestionThread(thread)) {
    return thread.state === "dismissed" ? "dismissed" : null;
  }
  return thread.state === "resolved" ? "resolved" : null;
}

function settledRunTitle(threads: readonly CommentThread[]): string {
  const kinds = new Set(threads.map((thread) => settledCommentKind(thread)));
  const count = threads.length;
  if (kinds.size === 1 && kinds.has("resolved")) return `${count} resolved comments`;
  if (kinds.size === 1 && kinds.has("dismissed")) return `${count} dismissed questions`;
  return `${count} closed comments`;
}

export function commentListEntries(threads: readonly CommentThread[]): CommentListEntry[] {
  const entries: CommentListEntry[] = [];
  let group: CommentThread[] = [];

  const flush = () => {
    const first = group[0];
    if (!first) return;
    if (group.length >= 2) {
      entries.push({
        kind: "run",
        id: first.root.id,
        title: settledRunTitle(group),
        threads: group as [CommentThread, CommentThread, ...CommentThread[]],
      });
    } else {
      entries.push({ kind: "thread", thread: first });
    }
    group = [];
  };

  for (const thread of threads) {
    if (settledCommentKind(thread)) {
      group.push(thread);
      continue;
    }
    flush();
    entries.push({ kind: "thread", thread });
  }
  flush();
  return entries;
}

export function commentInThreads(
  threads: readonly CommentThread[],
  id: string,
): { thread: CommentThread; commentId: string } | null {
  for (const thread of threads) {
    if (thread.root.id === id) return { thread, commentId: thread.root.id };
    const reply = thread.replies.find((message) => message.id === id);
    if (reply) return { thread, commentId: reply.id };
  }
  return null;
}

export function runIdContaining(
  entries: readonly CommentListEntry[],
  threadId: string,
): string | null {
  for (const entry of entries) {
    if (entry.kind !== "run") continue;
    if (entry.threads.some((thread) => thread.root.id === threadId)) return entry.id;
  }
  return null;
}

