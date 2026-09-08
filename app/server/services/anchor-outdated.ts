import type { Comment, CommentMessage, CommentsResponse } from "../schemas.js";
import { issueChangeCommitShas } from "./change.js";
import { IssueError } from "./errors.js";
import { runGit } from "./git-read.js";
import { readAll, readComments, readIssueOrThrow } from "./issues.js";
import { requireProjectWorkspace } from "./project-workspace.js";
import { ancestorChain } from "./subtree.js";

function isCommitUnreachableMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("bad object") ||
    lower.includes("unknown revision") ||
    lower.includes("invalid object name")
  );
}

function isPathMissingAtCommitMessage(message: string): boolean {
  return message.toLowerCase().includes("does not exist in");
}

async function showPathAtCommit(
  workspace: string,
  sha: string,
  path: string,
): Promise<string | null> {
  try {
    return await runGit(["show", `${sha}:${path}`], workspace);
  } catch (err) {
    if (err instanceof IssueError && err.code === "git-failed") {
      if (isPathMissingAtCommitMessage(err.message)) return null;
      if (isCommitUnreachableMessage(err.message)) {
        throw new IssueError("commit-unreachable", err.message);
      }
    }
    throw err;
  }
}

function linesOf(contents: string): string[] {
  if (contents === "") return [];
  const lines = contents.split("\n");
  if (contents.endsWith("\n")) lines.pop();
  return lines;
}

function rangeLines(
  contents: string,
  startLine: number,
  endLine: number,
): string[] | null {
  const lines = linesOf(contents);
  if (endLine > lines.length) return null;
  return lines.slice(startLine - 1, endLine);
}

function rangeOutdated(
  atAnchor: string | null,
  atHead: string | null,
  startLine: number,
  endLine: number,
): boolean {
  if (atAnchor === null || atHead === null) return true;
  const before = rangeLines(atAnchor, startLine, endLine);
  const after = rangeLines(atHead, startLine, endLine);
  if (before === null || after === null) return true;
  return before.some((line, i) => line !== after[i]);
}

export async function deriveAnchoredOutdated(
  issueId: string,
  comments: Comment[],
): Promise<CommentMessage[]> {
  if (!comments.some((comment) => comment.anchor)) return comments;

  const issue = readIssueOrThrow(issueId);
  const head = issueChangeCommitShas(issue).at(-1);
  if (!head) {
    return comments.map((comment) =>
      comment.anchor ? { ...comment, outdated: true } : comment,
    );
  }

  const chain = ancestorChain(issueId, readAll().issues);
  const workspace = requireProjectWorkspace(chain[0]!.id);

  return Promise.all(
    comments.map(async (comment) => {
      if (!comment.anchor) return comment;
      const { path, commitSha, line, startLine } = comment.anchor;
      const start = startLine ?? line;
      const [atAnchor, atHead] = await Promise.all([
        showPathAtCommit(workspace, commitSha, path),
        showPathAtCommit(workspace, head, path),
      ]);
      if (!rangeOutdated(atAnchor, atHead, start, line)) return comment;
      return { ...comment, outdated: true };
    }),
  );
}

export async function readCommentsWithOutdated(
  issueId: string,
): Promise<CommentsResponse> {
  const { messages, problems } = readComments(issueId);
  return {
    messages: await deriveAnchoredOutdated(issueId, messages),
    problems,
  };
}
