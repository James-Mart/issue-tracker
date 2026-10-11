import { describe, expect, it } from "vitest";
import { isNetworkConnectError } from "./abort-error-guard.js";

function errno(code: string, syscall: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${syscall} ${code}`), { code, syscall });
}

/** Mirrors the SDK's wrapping: SDK ConnectError → connect-node ConnectError → errno. */
function connectError(message: string, cause?: unknown): Error {
  const err = new Error(message, { cause });
  err.name = "ConnectError";
  return Object.assign(err, { code: 2 });
}

describe("abort-error-guard", () => {
  it("recognizes a ConnectError caused by a connection reset", () => {
    const reset = errno("ECONNRESET", "read");
    const err = connectError(
      "[unknown] [aborted] read ECONNRESET",
      connectError("[aborted] read ECONNRESET", reset),
    );
    expect(isNetworkConnectError(err)).toBe(true);
  });
});
