import type { ErrorRequestHandler } from "express";
import { IssueError } from "./services/errors.js";

function statusOf(err: unknown): number {
  if (err && typeof (err as { status?: unknown }).status === "number") {
    return (err as { status: number }).status;
  }
  return 500;
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const message = err instanceof Error ? err.message : "Internal server error";
  if (err instanceof IssueError && err.details) {
    res.status(statusOf(err)).json({ error: message, ...err.details });
    return;
  }
  res.status(statusOf(err)).json({ error: message });
};
