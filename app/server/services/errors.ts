export type IssueErrorCode = "not_found" | "validation";

const STATUS: Record<IssueErrorCode, number> = {
  not_found: 404,
  validation: 400,
};

export class IssueError extends Error {
  readonly code: IssueErrorCode;

  constructor(code: IssueErrorCode, message: string) {
    super(message);
    this.name = "IssueError";
    this.code = code;
  }

  get status(): number {
    return STATUS[this.code];
  }
}
