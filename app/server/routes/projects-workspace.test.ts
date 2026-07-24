import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import type { Server } from "http";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-07-09T14:00:00.000Z";
const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../testdata/supporting-docs",
);

let dir: string;
let workspaceDir: string;
let server: Server;
let baseUrl: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function makeFixtureWorkspace(): string {
  const ws = mkdtempSync(join(tmpdir(), "issue-workspace-fixtures-"));
  mkdirSync(join(ws, ".git"));
  cpSync(FIXTURES, ws, { recursive: true });
  return ws;
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-workspace-route-"));
  workspaceDir = makeFixtureWorkspace();
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
  it("returns fixture bytes with content-type for a markdown file", async () => {
    const expected = readFileSync(join(FIXTURES, "sample.md"), "utf8");
    const res = await getWorkspaceFile("p", "sample.md");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/markdown|text\/plain/);
    expect(await res.text()).toBe(expected);
  });

  it("returns workspace HTML and its relative asset", async () => {
    const html = readFileSync(join(FIXTURES, "workspace/sample.html"), "utf8");
    const asset = readFileSync(
      join(FIXTURES, "workspace/sample-asset.svg"),
      "utf8",
    );

    const htmlRes = await getWorkspaceFile("p", "workspace/sample.html");
    expect(htmlRes.status).toBe(200);
    expect(htmlRes.headers.get("content-type")).toMatch(/text\/html/);
    expect(await htmlRes.text()).toBe(html);

    const assetRes = await getWorkspaceFile("p", "workspace/sample-asset.svg");
    expect(assetRes.status).toBe(200);
    expect(assetRes.headers.get("content-type")).toMatch(/image\/svg\+xml/);
    expect(await assetRes.text()).toBe(asset);
  });

  it("refuses absolute paths, .., missing files, and unset workspace", async () => {
    const absolute = await getWorkspaceFile("p", "/etc/passwd");
    expect(absolute.status).toBe(400);
    expect(await absolute.json()).toEqual({
      error: "workspace-relative path must be relative",
    });

    const dotdot = await getWorkspaceFile("p", "../sample.md");
    expect(dotdot.status).toBe(400);
    expect(await dotdot.json()).toEqual({
      error: 'workspace-relative path must not contain ".." or empty segments',
    });

    const missing = await getWorkspaceFile("p", "missing.md");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: "workspace file not found: missing.md",
    });

    const unset = await getWorkspaceFile("no-ws", "sample.md");
    expect(unset.status).toBe(400);
    expect(await unset.json()).toEqual({
      error: "Project workspace is not set",
    });
  });

  it("returns 404 for an unknown project", async () => {
    const res = await getWorkspaceFile("missing", "sample.md");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'unknown issue "missing"',
    });
  });
});
