import { existsSync, readFileSync } from "fs";
import { commentsPathOf } from "./issues.js";
import { splitCommentLog, type CommentLog } from "./thread-state.js";

/** The issue's comment log, split into comments, thread events, edits, and problems. */
export function readCommentLog(id: string): CommentLog {
  const path = commentsPathOf(id);
  return splitCommentLog(id, existsSync(path) ? readFileSync(path, "utf8") : "");
}
