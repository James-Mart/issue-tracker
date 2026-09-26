import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveRuntimeSet } from "./cli-runtime-set.js";

describe("resolveRuntimeSet", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "issue-runtime-set-"));
  });

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("sets one phase from --file", () => {
    const path = join(dir, "build.sh");
    writeFileSync(path, "npm run build");
    expect(
      resolveRuntimeSet({ phase: "build", file: path }, undefined),
    ).toEqual({ runtime: { build: "npm run build" } });
  });

  it("clears one phase or the whole field", () => {
    expect(
      resolveRuntimeSet(
        { clear: true, phase: "build" },
        { build: "npm run build", start: "npm start" },
      ),
    ).toEqual({ runtime: { start: "npm start" } });
    expect(
      resolveRuntimeSet(
        { clear: true, phase: "build" },
        { build: "npm run build" },
      ),
    ).toEqual({ runtime: null });
    expect(resolveRuntimeSet({ clear: true }, undefined)).toEqual({
      runtime: null,
    });
  });

  it("rejects unknown phases and empty content", () => {
    const path = join(dir, "empty.sh");
    writeFileSync(path, "");
    expect(() =>
      resolveRuntimeSet({ phase: "deploy", file: path }, undefined),
    ).toThrow(/unknown runtime phase/);
    expect(() =>
      resolveRuntimeSet({ phase: "build", file: path }, undefined),
    ).toThrow(/cannot be empty/);
  });
});
