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

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-attachments-route-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);

  writeIssue("p", {
    kind: "project",
    title: "P",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("e", {
    kind: "epic",
    title: "E",
    partOf: "p",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("c", {
    kind: "task",
    title: "C",
    partOf: "e",
    order: 0,
    status: "todo",
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
});

async function upload(
  id: string,
  filename: string,
  body: Uint8Array<ArrayBuffer> | string,
): Promise<Response> {
  const form = new FormData();
  const bytes =
    typeof body === "string" ? new TextEncoder().encode(body) : body;
  form.append("file", new Blob([bytes]), filename);
  return fetch(`${baseUrl}/api/issues/${id}/attachments`, {
    method: "POST",
    body: form,
  });
}

describe("attachments HTTP API", () => {
  it("returns the stored unique name on basename collision", async () => {
    const first = await upload("c", "foo.tsx", "v1");
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual(
      expect.objectContaining({ name: "foo.tsx" }),
    );

    const second = await upload("c", "foo.tsx", "v2");
    expect(second.status).toBe(201);
    expect(await second.json()).toEqual(
      expect.objectContaining({ name: "foo-2.tsx", size: 2 }),
    );

    const listed = await fetch(`${baseUrl}/api/issues/c/attachments`);
    expect(await listed.json()).toEqual([
      expect.objectContaining({ name: "foo-2.tsx" }),
      expect.objectContaining({ name: "foo.tsx" }),
    ]);

    expect(
      await (await fetch(`${baseUrl}/api/issues/c/attachments/foo.tsx`)).text(),
    ).toBe("v1");
    expect(
      await (
        await fetch(`${baseUrl}/api/issues/c/attachments/foo-2.tsx`)
      ).text(),
    ).toBe("v2");
  });

  it("overwrites a reserved draft and refuses a non-reserved name", async () => {
    const created = await fetch(
      `${baseUrl}/api/issues/c/attachments/github-export-keep.md`,
      {
        method: "PUT",
        headers: { "content-type": "text/markdown; charset=utf-8" },
        body: "---\ntitle: Keep\n---\nv1\n",
      },
    );
    expect(created.status).toBe(200);
    expect(await created.json()).toEqual(
      expect.objectContaining({ name: "github-export-keep.md" }),
    );

    const updated = await fetch(
      `${baseUrl}/api/issues/c/attachments/github-export-keep.md`,
      {
        method: "PUT",
        headers: { "content-type": "text/plain" },
        body: "---\ntitle: Keep\n---\nv2\n",
      },
    );
    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual(
      expect.objectContaining({
        name: "github-export-keep.md",
        size: "---\ntitle: Keep\n---\nv2\n".length,
      }),
    );
    expect(
      await (
        await fetch(`${baseUrl}/api/issues/c/attachments/github-export-keep.md`)
      ).text(),
    ).toBe("---\ntitle: Keep\n---\nv2\n");

    const uploaded = await upload("c", "notes.md", "v1");
    expect(uploaded.status).toBe(201);
    const refused = await fetch(`${baseUrl}/api/issues/c/attachments/notes.md`, {
      method: "PUT",
      headers: { "content-type": "text/markdown" },
      body: "---\ntitle: Notes\n---\nv2\n",
    });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({
      error: 'attachment name "notes.md" is not a github-export draft',
      code: "validation",
    });
    expect(
      await (await fetch(`${baseUrl}/api/issues/c/attachments/notes.md`)).text(),
    ).toBe("v1");
  });
});
