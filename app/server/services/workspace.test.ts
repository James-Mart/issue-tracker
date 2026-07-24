import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-07-09T14:00:00.000Z";
let dir: string;
let gitDir: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function makeGitWorkspace(): string {
  const ws = mkdtempSync(join(tmpdir(), "issue-workspace-"));
  mkdirSync(join(ws, ".git"));
  return ws;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-workspace-"));
  gitDir = makeGitWorkspace();
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);
  writeIssue("p", { kind: "project", title: "P", order: 0, createdAt: AT, updatedAt: AT });
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
  rmSync(gitDir, { recursive: true, force: true });
});

async function loadService() {
  return import("./issues.js");
}

describe("project workspace", () => {
  it("can be set on create", async () => {
    const { create, read } = await loadService();
    const record = await create({
      kind: "project",
      title: "With workspace",
      workspace: gitDir,
    });
    const detail = read(record.id);
    expect(detail.kind).toBe("project");
    if (detail.kind === "project") {
      expect(detail.workspace).toBe(gitDir);
    }
  });

  it("round-trips through update and read", async () => {
    const { update, read } = await loadService();
    await update("p", { workspace: gitDir });
    const detail = read("p");
    expect(detail.kind).toBe("project");
    if (detail.kind === "project") {
      expect(detail.workspace).toBe(gitDir);
    }
  });

  it("clears workspace with null", async () => {
    const { update, read } = await loadService();
    await update("p", { workspace: gitDir });
    await update("p", { workspace: null });
    const detail = read("p");
    expect(detail.kind).toBe("project");
    if (detail.kind === "project") {
      expect(detail.workspace).toBeUndefined();
    }
    const raw = JSON.parse(readFileSync(join(dir, "p", "issue.json"), "utf8"));
    expect(raw).not.toHaveProperty("workspace");
  });

  it("rejects a relative path", async () => {
    const { update } = await loadService();
    await expect(update("p", { workspace: "relative/path" })).rejects.toThrow(
      /absolute/i,
    );
  });

  it("rejects a non-existent path", async () => {
    const { update } = await loadService();
    await expect(
      update("p", { workspace: join(tmpdir(), "no-such-workspace-dir") }),
    ).rejects.toThrow(/does not exist/i);
  });

  it("rejects a directory without .git", async () => {
    const bare = mkdtempSync(join(tmpdir(), "issue-bare-dir-"));
    try {
      const { update } = await loadService();
      await expect(update("p", { workspace: bare })).rejects.toThrow(/\.git/i);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it("accepts a .git file (worktree)", async () => {
    const ws = mkdtempSync(join(tmpdir(), "issue-worktree-"));
    try {
      writeFileSync(join(ws, ".git"), "gitdir: /tmp/example\n");
      const { update, read } = await loadService();
      await update("p", { workspace: ws });
      const detail = read("p");
      if (detail.kind === "project") {
        expect(detail.workspace).toBe(ws);
      }
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it("rejects workspace on a non-project issue", async () => {
    writeIssue("e", {
      kind: "epic",
      title: "E",
      partOf: "p",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    const { update } = await loadService();
    await expect(update("e", { workspace: gitDir })).rejects.toThrow(/workspace/i);
  });
});

describe("workspace-relative path guards", () => {
  it("resolves a safe relative path and refuses escape", async () => {
    const { assertSafeWorkspaceRelPath, resolveUnderWorkspace } = await import(
      "./workspace.js"
    );
    writeFileSync(join(gitDir, "doc.md"), "# Doc");
    expect(assertSafeWorkspaceRelPath("doc.md")).toBeUndefined();
    expect(resolveUnderWorkspace(gitDir, "doc.md")).toBe(join(gitDir, "doc.md"));

    expect(() => assertSafeWorkspaceRelPath("/tmp/x.md")).toThrow(/relative/);
    expect(() => assertSafeWorkspaceRelPath("../x.md")).toThrow(/\.\./);
    expect(() => resolveUnderWorkspace(gitDir, "../x.md")).toThrow(/\.\./);
  });
});
