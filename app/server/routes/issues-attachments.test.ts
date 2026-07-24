import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import type { Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_ATTACHMENT_BYTES } from "../services/attachments.js";

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
  body: Uint8Array | string,
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
  it("multipart upload/download/delete use HTTP status and content-type", async () => {
    const payload = "export const x = 1;\n";
    const created = await upload("c", "mock.tsx", payload);
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual(
      expect.objectContaining({ name: "mock.tsx", size: payload.length }),
    );

    const listed = await fetch(`${baseUrl}/api/issues/c/attachments`);
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual([
      expect.objectContaining({ name: "mock.tsx" }),
    ]);

    const downloaded = await fetch(
      `${baseUrl}/api/issues/c/attachments/mock.tsx`,
    );
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("content-type")).toMatch(
      /application\/octet-stream/,
    );
    expect(await downloaded.text()).toBe(payload);

    const detail = await fetch(`${baseUrl}/api/issues/c`);
    const detailJson = (await detail.json()) as Record<string, unknown>;
    expect(detailJson).not.toHaveProperty("attachments");
    expect(JSON.stringify(detailJson)).not.toContain(payload);

    const deleted = await fetch(
      `${baseUrl}/api/issues/c/attachments/mock.tsx`,
      { method: "DELETE" },
    );
    expect(deleted.status).toBe(204);
  });

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

  it("uploads, lists, downloads, and deletes attachments on a project", async () => {
    const uploadRes = await upload("p", "vision.md", "# Vision");
    expect(uploadRes.status).toBe(201);
    expect(await uploadRes.json()).toEqual(
      expect.objectContaining({ name: "vision.md" }),
    );

    const listed = await fetch(`${baseUrl}/api/issues/p/attachments`);
    expect(await listed.json()).toEqual([
      expect.objectContaining({ name: "vision.md" }),
    ]);

    const download = await fetch(
      `${baseUrl}/api/issues/p/attachments/vision.md`,
    );
    expect(download.status).toBe(200);
    expect(await download.text()).toBe("# Vision");

    const del = await fetch(`${baseUrl}/api/issues/p/attachments/vision.md`, {
      method: "DELETE",
    });
    expect(del.status).toBe(204);
    expect(await (await fetch(`${baseUrl}/api/issues/p/attachments`)).json()).toEqual(
      [],
    );
  });

  it("rejects oversize uploads with 4xx", async () => {
    const oversize = new Uint8Array(MAX_ATTACHMENT_BYTES + 1);
    const res = await upload("c", "big.bin", oversize);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: `attachment exceeds ${MAX_ATTACHMENT_BYTES} byte limit`,
    });
  });
});
