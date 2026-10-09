import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import type { Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-07-09T14:00:00.000Z";

let dir: string;
let workspaceDir: string;
let server: Server;
let baseUrl: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-workspace-route-"));
  workspaceDir = mkdtempSync(join(tmpdir(), "issue-workspace-"));
  mkdirSync(join(workspaceDir, ".git"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);

  writeIssue("p", {
    kind: "project",
    title: "P",
    order: 0,
    workspace: workspaceDir,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("no-ws", {
    kind: "project",
    title: "No workspace",
    order: 1,
    createdAt: AT,
    updatedAt: AT,
  });

  const { createApp } = await import("../app.js");
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("expected TCP listen address");
  }
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  rmSync(dir, { recursive: true, force: true });
  rmSync(workspaceDir, { recursive: true, force: true });
});

async function getWorkspaceFile(
  projectId: string,
  relativePath: string,
): Promise<Response> {
  return fetch(
    `${baseUrl}/api/projects/${projectId}/workspace/${encodeURIComponent(relativePath)}`,
  );
}

describe("project workspace file HTTP API", () => {
  it("refuses absolute paths, .., missing files, and unset workspace", async () => {
    const absolute = await getWorkspaceFile("p", "/etc/passwd");
    expect(absolute.status).toBe(400);
    expect(await absolute.json()).toEqual({
      error: "workspace-relative path must be relative",
      code: "validation",
    });

    const dotdot = await getWorkspaceFile("p", "../sample.md");
    expect(dotdot.status).toBe(400);
    expect(await dotdot.json()).toEqual({
      error: 'workspace-relative path must not contain ".." or empty segments',
      code: "validation",
    });

    const missing = await getWorkspaceFile("p", "missing.md");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: "workspace file not found: missing.md",
      code: "not_found",
    });

    const unset = await getWorkspaceFile("no-ws", "sample.md");
    expect(unset.status).toBe(400);
    expect(await unset.json()).toEqual({
      error: "Project workspace is not set",
      code: "validation",
    });
  });
});
