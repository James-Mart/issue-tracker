import type { Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestLogger } from "./app.js";

type Listener = () => void;

function createMockResponse(statusCode = 200): {
  res: Response;
  emit: (event: "finish" | "close") => void;
  setWritableFinished: (value: boolean) => void;
} {
  const listeners: Partial<Record<"finish" | "close", Listener[]>> = {};
  let writableFinished = false;

  const res = {
    statusCode,
    get writableFinished() {
      return writableFinished;
    },
    on(event: "finish" | "close", listener: Listener) {
      (listeners[event] ??= []).push(listener);
      return res;
    },
  } as unknown as Response;

  return {
    res,
    emit(event) {
      for (const listener of listeners[event] ?? []) {
        listener();
      }
    },
    setWritableFinished(value) {
      writableFinished = value;
    },
  };
}

describe("requestLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs when the response closes without finishing", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const req = { method: "GET", originalUrl: "/api/foo?bar=1" } as Request;
    const { res, emit } = createMockResponse();
    const next = vi.fn();

    requestLogger(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    emit("close");

    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]?.[0]).toMatch(
      /^\[closed\] GET \/api\/foo \d+\.\dms$/,
    );
  });

  it("logs 500 responses instead of dropping them", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const req = { method: "POST", originalUrl: "/api/error" } as Request;
    const { res, emit, setWritableFinished } = createMockResponse(500);
    const next = vi.fn();

    requestLogger(req, res, next);
    setWritableFinished(true);
    emit("finish");

    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]?.[0]).toMatch(
      /^\[500\] POST \/api\/error \d+\.\dms$/,
    );
  });
});
