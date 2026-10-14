import { isLineAnchor, type CommentAnchor } from "../../issues/lib/comment-anchor";
import { anchorLineRange } from "../../issues/lib/comment-anchor-snippet";

/** `path:line`, `path:start-end`, the file path, or "Review comment" when unanchored. */
export function reviewThreadLocation(anchor: CommentAnchor | undefined): string {
  if (!anchor) return "Review comment";
  if (!isLineAnchor(anchor)) return anchor.path;
  const { start, end } = anchorLineRange(anchor);
  const lines = start === end ? String(end) : `${start}-${end}`;
  return `${anchor.path}:${lines}`;
}

/** First non-blank line of a comment body. */
export function reviewThreadExcerpt(body: string): string {
  const line = body
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  return line ?? "";
}
