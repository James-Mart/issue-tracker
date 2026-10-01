/** A line (or line range) in a diff at one commit. */
export type LineCommentAnchor = {
  path: string;
  side: "old" | "new";
  line: number;
  startLine?: number;
  commitSha: string;
};

/** A whole file at one commit. `side` and `line` are both absent. */
export type FileCommentAnchor = {
  path: string;
  commitSha: string;
};

export type CommentAnchor = LineCommentAnchor | FileCommentAnchor;

export function isLineAnchor(anchor: CommentAnchor): anchor is LineCommentAnchor {
  return "line" in anchor && typeof anchor.line === "number";
}
