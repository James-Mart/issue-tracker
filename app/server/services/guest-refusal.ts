import { IssueError } from "./errors.js";

/**
 * The one guest refusal shape. HTTP surfaces this as 403
 * `{ error: what, code: "guest" }` through the usual error handler.
 */
export function throwGuestRefusal(what: string): never {
  throw new IssueError("guest", what);
}
