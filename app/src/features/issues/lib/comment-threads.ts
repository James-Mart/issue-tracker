import type {
  CommentMessage,
  CommentThreadView,
  Problem,
  ResearcherRun,
  ThreadEventRequest,
  ThreadView,
} from "@server/schemas";

export const STORY_COMPOSER_LABEL =
  "Add a comment or ask a question about this change";

export type CommentThread = {
  root: CommentMessage;
  replies: CommentMessage[];
  kind: ThreadView["kind"];
  state: ThreadView["state"];
  linkedTaskId?: string;
  researcherRun?: ResearcherRun;
  converted?: ThreadView["converted"];
  readyToTask: boolean;
};

export function isQuestionThread(thread: { kind: ThreadView["kind"] }): boolean {
  return thread.kind === "question";
}

/** Unanchored review notes with no replies render as a single message. */
export function isPlainNote(thread: CommentThread): boolean {
  return (
    !isQuestionThread(thread) &&
    thread.converted === undefined &&
    thread.root.anchor === undefined &&
    thread.replies.length === 0
  );
}

export function threadStateActions(
  thread: CommentThread,
  post: (event: ThreadEventRequest["event"]) => void,
): {
  onResolve?: () => void;
  onUnresolve?: () => void;
  onDismiss?: () => void;
  onReopen?: () => void;
  onConvert?: () => void;
} {
  if (isQuestionThread(thread)) {
    return {
      onDismiss: () => post("dismissed"),
      onReopen: () => post("reopened"),
      onConvert: () => post("converted"),
    };
  }
  return {
    onResolve: () => post("resolved"),
    onUnresolve: () => post("unresolved"),
  };
}

export function groupCommentThreads(
  messages: CommentMessage[],
  views: CommentThreadView[] = [],
): CommentThread[] {
  const roots = messages.filter((message) => !message.replyTo);
  const rootIds = new Set(roots.map((root) => root.id));
  const repliesByRoot = new Map<string, CommentMessage[]>();
  const viewByRoot = new Map(views.map((view) => [view.rootId, view]));

  for (const message of messages) {
    if (!message.replyTo || !rootIds.has(message.replyTo)) continue;
    const list = repliesByRoot.get(message.replyTo) ?? [];
    list.push(message);
    repliesByRoot.set(message.replyTo, list);
  }

  return [...roots]
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((root) => {
      const view = viewByRoot.get(root.id);
      const state = view?.state ?? "open";
      const kind = view?.kind ?? (root.kind === "question" ? "question" : "review");
      const linkedTaskId = view?.linkedTaskId;
      const researcherRun = view?.researcherRun;
      const converted = view?.converted;
      return {
        root,
        replies: repliesByRoot.get(root.id) ?? [],
        kind,
        state,
        ...(linkedTaskId ? { linkedTaskId } : {}),
        ...(researcherRun ? { researcherRun } : {}),
        ...(converted ? { converted } : {}),
        readyToTask: view?.readyToTask ?? !isQuestionThread({ kind }),
      };
    });
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
