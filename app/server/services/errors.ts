export type IssueErrorCode =
  | "not_found"
  | "validation"
  | "conflict"
  | "no-free-slot"
  | "read_only"
  | "guest"
  | "gh-missing"
  | "gh-unauthenticated"
  | "gh-failed"
  | "git-missing"
  | "git-failed"
  | "commit-unreachable"
  | "commits-not-contiguous"
  | "change-too-large"
  | "attachment-too-large"
  | "not-github-pr-url"
  | "pr-not-found"
  | "pr-wrong-repository"
  | "merge-settings-locked";

const STATUS: Record<IssueErrorCode, number> = {
  not_found: 404,
  validation: 400,
  conflict: 409,
  "no-free-slot": 409,
  read_only: 403,
  guest: 403,
  "gh-missing": 503,
  "gh-unauthenticated": 401,
  "gh-failed": 502,
  "git-missing": 503,
  "git-failed": 502,
  "commit-unreachable": 404,
  "commits-not-contiguous": 400,
  "change-too-large": 413,
  "attachment-too-large": 413,
  "not-github-pr-url": 400,
  "pr-not-found": 404,
  "pr-wrong-repository": 400,
  "merge-settings-locked": 409,
};

export class IssueError extends Error {
  readonly code: IssueErrorCode;
  /** Extra JSON fields merged into the HTTP `{ error }` body (e.g. holder ids). */
  readonly details?: Record<string, unknown>;

  constructor(
    code: IssueErrorCode,
    message: string,
    details?: Record<string, unknown>,
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

/** The write already committed. Say why the follow-up (a session start) failed. */
export function errorAfterCommit(error: unknown, committed: string): IssueError {
  const reason = error instanceof Error ? error.message : String(error);
  const code = error instanceof IssueError ? error.code : "validation";
  return new IssueError(
    code,
    `${committed}: ${reason}`,
    error instanceof IssueError ? error.details : undefined,
  );
}
