export type IssueErrorCode = "not_found" | "validation" | "conflict";

const STATUS: Record<IssueErrorCode, number> = {
  not_found: 404,
  validation: 400,
  conflict: 409,
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
