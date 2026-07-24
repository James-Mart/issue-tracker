import type { ErrorRequestHandler } from "express";

function statusOf(err: unknown): number {
  if (err && typeof (err as { status?: unknown }).status === "number") {
    return (err as { status: number }).status;
  }
  return 500;
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const message = err instanceof Error ? err.message : "Internal server error";
  res.status(statusOf(err)).json({ error: message });
};
