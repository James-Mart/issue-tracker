import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertSafeWorkspaceRelPath, resolveUnderWorkspace } from "./workspace.js";

let gitDir: string;

beforeEach(() => {
  gitDir = mkdtempSync(join(tmpdir(), "issue-workspace-"));
});

afterEach(() => {
  rmSync(gitDir, { recursive: true, force: true });
});

describe("workspace-relative path guards", () => {
  it("resolves a safe relative path and refuses escape", async () => {
    writeFileSync(join(gitDir, "doc.md"), "# Doc");
    expect(assertSafeWorkspaceRelPath("doc.md")).toBeUndefined();
    expect(resolveUnderWorkspace(gitDir, "doc.md")).toBe(join(gitDir, "doc.md"));

    expect(() => assertSafeWorkspaceRelPath("/tmp/x.md")).toThrow(/relative/);
    expect(() => assertSafeWorkspaceRelPath("../x.md")).toThrow(/\.\./);
    expect(() => resolveUnderWorkspace(gitDir, "../x.md")).toThrow(/\.\./);
  });
});
