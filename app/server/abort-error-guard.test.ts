import { describe, expect, it } from "vitest";
import {
  isAbortError,
  isNetworkConnectError,
  isSpawnEnoent,
} from "./abort-error-guard.js";

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
  it("recognizes an AbortError", () => {
    expect(isAbortError(new DOMException("aborted", "AbortError"))).toBe(true);
    expect(isAbortError(new Error("boom"))).toBe(false);
  });

  it("recognizes a spawn ENOENT from a removed cwd", () => {
    expect(isSpawnEnoent(errno("ENOENT", "spawn /bin/bash"))).toBe(true);
  });

  it("does not swallow other ENOENTs or spawn failures", () => {
    expect(isSpawnEnoent(errno("ENOENT", "open"))).toBe(false);
    expect(isSpawnEnoent(errno("EACCES", "spawn /bin/bash"))).toBe(false);
    expect(isSpawnEnoent("ENOENT")).toBe(false);
  });

  it("recognizes a ConnectError caused by a connection reset", () => {
    const reset = errno("ECONNRESET", "read");
    const err = connectError(
      "[unknown] [aborted] read ECONNRESET",
      connectError("[aborted] read ECONNRESET", reset),
    );
    expect(isNetworkConnectError(err)).toBe(true);
  });

  it("does not swallow ConnectErrors without a transport cause", () => {
    expect(isNetworkConnectError(connectError("[permission_denied] nope"))).toBe(
      false,
    );
    expect(
      isNetworkConnectError(
        connectError("[internal] boom", errno("ENOENT", "open")),
      ),
    ).toBe(false);
  });

  it("does not swallow a bare network errno outside a ConnectError", () => {
    expect(isNetworkConnectError(errno("ECONNRESET", "read"))).toBe(false);
  });
});
