import {
  commentEditAuthorSchema,
  commentEditRequestSchema,
  formatZodError,
  type Comment,
  type CommentEdit,
  type CommentMessage,
  type CommentsResponse,
  type Issue,
  type ThreadView,
} from "../schemas.js";
import { IssueError } from "./errors.js";
import {
  appendCommentLogRecords,
  readAll,
  readIssueOrThrow,
  requireKindCapability,
  serialize,
  taskStatusesForStory,
} from "./issues.js";
import { readCommentLog } from "./comment-log.js";
import { listReviewViews } from "./reviews.js";
import { ancestorChain } from "./subtree.js";
import { findThreadRoot } from "./thread-events.js";
import { commentsFromLog } from "./thread-state.js";

/** Reasons a comment edit is refused. `resolved` is a thread that is no longer open. */
export type CommentEditRefusal =
  | "submitted"
  | "linked"
  | "question"
  | "researcher reply"
  | "Story note"
  | "resolved"
  | "dismissed";

const RESEARCHER_ROLE = "agent";
const RESEARCHER_NAME = "Researcher";

export function isResearcherReply(
  message: Pick<Comment, "replyTo" | "role" | "name">,
): boolean {
  return (
    message.replyTo !== undefined &&
    message.role === RESEARCHER_ROLE &&
    message.name === RESEARCHER_NAME
  );
}

/**
 * One definition of the editability rule. Null means the comment may be edited.
 * Researcher replies are checked before the thread, so a researcher answer on
 * an otherwise editable thread still refuses as `researcher reply`.
 */
export function commentEditReason(
  issueKind: Issue["kind"],
  message: Pick<Comment, "replyTo" | "role" | "name">,
  thread: ThreadView | undefined,
  root: Pick<Comment, "anchor"> | undefined,
  submittedRootIds: ReadonlySet<string>,
): CommentEditRefusal | null {
  if (isResearcherReply(message)) return "researcher reply";
  if (thread?.kind === "question") return "question";
  if (
    issueKind !== "story" ||
    thread === undefined ||
    root?.anchor === undefined
  ) {
    return "Story note";
  }
  if (submittedRootIds.has(thread.rootId)) return "submitted";
  if (thread.linkedTaskId !== undefined) return "linked";
  if (thread.state !== "open") return thread.state;
  return null;
}

export function commentEditRefusalMessage(
  commentId: string,
  reason: CommentEditRefusal,
): string {
  return `cannot edit comment "${commentId}": ${reason}`;
}

function submittedRootIds(issue: Issue): Set<string> {
  if (issue.kind !== "story") return new Set();
  const projectId = ancestorChain(issue.id, readAll().issues)[0]!.id;
  const ids = new Set<string>();
  for (const review of listReviewViews(projectId, issue.id).reviews) {
    for (const submission of review.submissions) {
      for (const threadId of submission.threadIds) ids.add(threadId);
    }
  }
  return ids;
}

function editRefusalFor(
  issue: Issue,
  message: Pick<Comment, "id" | "replyTo" | "role" | "name">,
  threadsByRoot: Map<string, ThreadView>,
  messagesById: Map<string, Pick<Comment, "anchor">>,
  submitted: ReadonlySet<string>,
): CommentEditRefusal | null {
  const rootId = message.replyTo ?? message.id;
  return commentEditReason(
    issue.kind,
    message,
    threadsByRoot.get(rootId),
    messagesById.get(rootId),
    submitted,
  );
}

/** Set `editable` on every message of a comments view. */
export function withEditableFlag(
  issue: Issue,
  response: CommentsResponse,
): CommentsResponse {
  const submitted = submittedRootIds(issue);
  const threadsByRoot = new Map(
    response.threads.map((thread) => [thread.rootId, thread]),
  );
  const messagesById = new Map(
    response.messages.map((message) => [message.id, message]),
  );
  return {
    ...response,
    messages: response.messages.map((message) => ({
      ...message,
      editable:
        editRefusalFor(
          issue,
          message,
          threadsByRoot,
          messagesById,
          submitted,
        ) === null,
    })),
  };
}

/**
 * Append a comment-edit when the comment is editable. The original comment
 * line stays. Callers see the latest body because the log is folded on read.
 * The comments watcher publishes the comments event from that append.
 * `raw` is the `{ body }` request. `author` is the editor (`human` on HTTP).
 */
export function editComment(
  issueId: string,
  commentId: string,
  raw: unknown,
  author: { role: string; name?: string },
): Promise<CommentMessage> {
  return serialize(() => {
    requireKindCapability(issueId, "comments");
    const body = commentEditRequestSchema.safeParse(raw);
    if (!body.success) {
      throw new IssueError(
        "validation",
        formatZodError(body.error, "invalid comment edit"),
      );
    }
    const editor = commentEditAuthorSchema.safeParse(
      author.name !== undefined ? author : { role: author.role },
    );
    if (!editor.success) {
      throw new IssueError(
        "validation",
        formatZodError(editor.error, "invalid comment edit"),
      );
    }
    const issue = readIssueOrThrow(issueId);
    const log = readCommentLog(issueId);
    const taskStatusById =
      issue.kind === "story" ? taskStatusesForStory(issueId) : new Map();
    const view = commentsFromLog(issueId, log, taskStatusById);
    const message = view.messages.find((item) => item.id === commentId);
    if (!message) {
      throw new IssueError("not_found", `unknown comment "${commentId}"`);
    }
    const rootId = message.replyTo ?? message.id;
    const root = findThreadRoot(log.messages, rootId);
    const reason = commentEditReason(
      issue.kind,
      message,
      view.threads.find((thread) => thread.rootId === rootId),
      root,
      submittedRootIds(issue),
    );
    if (reason) {
      throw new IssueError(
        "conflict",
        commentEditRefusalMessage(commentId, reason),
      );
    }
    const record: CommentEdit = {
      type: "comment-edit",
      commentId,
      body: body.data.body,
      at: new Date().toISOString(),
      role: editor.data.role,
      ...(editor.data.name !== undefined ? { name: editor.data.name } : {}),
    };
    appendCommentLogRecords(issueId, [record]);
    return { ...message, body: record.body, editable: true };
  });
}
