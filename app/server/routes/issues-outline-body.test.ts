import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import type { Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-07-09T14:00:00.000Z";

let dir: string;
let server: Server;
let baseUrl: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function writeOutline(
  id: string,
  description: string,
  versions: Record<number, string>,
  bodyVersion: number,
): void {
  writeIssue(id, {
    kind: "outline",
    title: id,
    partOf: "p",
    bodyVersion,
    order: 0,
    archived: false,
    createdAt: AT,
    updatedAt: AT,
  });
  writeFileSync(join(dir, id, "description.md"), description);
  const versionsDir = join(dir, id, "versions");
  mkdirSync(versionsDir, { recursive: true });
  for (const [version, body] of Object.entries(versions)) {
    writeFileSync(join(versionsDir, `${version}.md`), body);
  }
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-outline-body-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);

  writeIssue("p", {
    kind: "project",
    title: "P",
    workspace: "/repo/root",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeOutline("spec", "beta\n", { 1: "alpha\n", 2: "beta\n" }, 2);

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
});

describe("outline body HTTP API", () => {
  it("serves the latest outline body from description.md", async () => {
    const latest = await fetch(`${baseUrl}/api/issues/spec/outline/body?version=2`);
    expect(latest.status).toBe(200);
    expect(await latest.json()).toEqual({ version: 2, body: "beta\n" });
  });
});
