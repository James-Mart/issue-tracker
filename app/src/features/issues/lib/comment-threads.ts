import type { CommentMessage, Problem } from "@server/schemas";

export type CommentThread = {
  root: CommentMessage;
  replies: CommentMessage[];
};

export function groupCommentThreads(
  messages: CommentMessage[],
): CommentThread[] {
  const roots = messages.filter((message) => !message.replyTo);
  const rootIds = new Set(roots.map((root) => root.id));
  const repliesByRoot = new Map<string, CommentMessage[]>();

  for (const message of messages) {
    if (!message.replyTo || !rootIds.has(message.replyTo)) continue;
    const list = repliesByRoot.get(message.replyTo) ?? [];
    list.push(message);
    repliesByRoot.set(message.replyTo, list);
  }

  return [...roots]
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((root) => ({
      root,
      replies: repliesByRoot.get(root.id) ?? [],
    }));
}

export function selectAnchoredThreads(
  threads: CommentThread[],
  path: string,
  side: "old" | "new",
): Map<number, CommentThread[]> {
  const byLine = new Map<number, CommentThread[]>();
  for (const thread of threads) {
    const anchor = thread.root.anchor;
    if (!anchor || anchor.path !== path || anchor.side !== side) continue;
    const list = byLine.get(anchor.line) ?? [];
    list.push(thread);
    byLine.set(anchor.line, list);
  }
  return byLine;
}

export function formatAnchorLineLabel(
  anchor: Pick<NonNullable<CommentMessage["anchor"]>, "line" | "startLine">,
): string {
  if (anchor.startLine === undefined || anchor.startLine === anchor.line) {
    return `line ${anchor.line}`;
  }
  const start = Math.min(anchor.startLine, anchor.line);
  const end = Math.max(anchor.startLine, anchor.line);
  return `lines ${start}-${end}`;
}

export type CommentThreadsResult = {
  threads: CommentThread[];
  problems: Problem[];
};
