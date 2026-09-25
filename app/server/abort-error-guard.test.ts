import { describe, expect, it } from "vitest";
import { isAbortError, isSpawnEnoent } from "./abort-error-guard.js";

function errno(code: string, syscall: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${syscall} ${code}`), { code, syscall });
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
});
