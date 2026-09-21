import { storeReadOnly } from "../config.js";
import { IssueError } from "./errors.js";

/** Refuse tracker-store writes when `ISSUE_TRACKER_STORE_READ_ONLY=1`. */
export function assertStoreWritable(): void {
  if (storeReadOnly) {
    throw new IssueError("read_only", "tracker store is read-only");
  }
}
