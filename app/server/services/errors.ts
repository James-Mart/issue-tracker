export type IssueErrorCode =
  | "not_found"
  | "validation"
  | "conflict"
  | "gh-missing"
  | "gh-unauthenticated"
  | "gh-failed"
  | "git-missing"
  | "git-failed"
  | "commit-unreachable"
  | "commits-not-contiguous"
  | "not-github-pr-url";

const STATUS: Record<IssueErrorCode, number> = {
  not_found: 404,
  validation: 400,
  conflict: 409,
  "gh-missing": 503,
  "gh-unauthenticated": 401,
  "gh-failed": 502,
  "git-missing": 503,
  "git-failed": 502,
  "commit-unreachable": 404,
  "commits-not-contiguous": 400,
  "not-github-pr-url": 400,
};

export class IssueError extends Error {
  readonly code: IssueErrorCode;
  /** Extra JSON fields merged into the HTTP `{ error }` body (e.g. holder ids). */
  readonly details?: Record<string, string>;

  constructor(
    code: IssueErrorCode,
    message: string,
    details?: Record<string, string>,
  ) {
    super(message);
    this.name = "IssueError";
    this.code = code;
    if (details) this.details = details;
  }

  get status(): number {
    return STATUS[this.code];
  }
}
