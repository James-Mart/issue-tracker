import { isLineAnchor, type Comment, type CommentMessage } from "../schemas.js";
import { issueChangeCommitShas } from "./change.js";
import { readPathAtCommit } from "./git-blob-batch.js";
import { readAll, readIssueOrThrow } from "./issues.js";
import { requireProjectWorkspace } from "./project-workspace.js";
import { ancestorChain } from "./subtree.js";

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
      const { path, commitSha } = comment.anchor;
      if (!isLineAnchor(comment.anchor)) {
        const atHead = await readPathAtCommit(workspace, head, path);
        if (atHead === null) return { ...comment, outdated: true };
        return comment;
      }
      const { line, startLine } = comment.anchor;
      const start = startLine ?? line;
      const [atAnchor, atHead] = await Promise.all([
        readPathAtCommit(workspace, commitSha, path),
        readPathAtCommit(workspace, head, path),
      ]);
      if (!rangeOutdated(atAnchor, atHead, start, line)) return comment;
      return { ...comment, outdated: true };
    }),
  );
}
