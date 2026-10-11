import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyGuestStore } from "./copy-guest-store.js";

const roots: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});

describe("copyGuestStore", () => {
  it("refuses when --into resolves outside AGENT_STACK_DATA_DIR", () => {
    const data = tempDir("guest-copy-data-");
    const outside = tempDir("guest-copy-out-");
    const into = join(outside, "guest");
    mkdirSync(into);
    expect(() =>
      copyGuestStore({
        into,
        sourceRoot: tempDir("guest-copy-src-"),
        dataDir: data,
      }),
    ).toThrow("is not under AGENT_STACK_DATA_DIR");
  });
});
