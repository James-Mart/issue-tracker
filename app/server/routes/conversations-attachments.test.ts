import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import type { Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_ATTACHMENT_BYTES } from "../services/attachments.js";

const AT = "2026-07-09T14:00:00.000Z";
let root: string;
let issuesRoot: string;
let workspaceDir: string;
let server: Server;
let baseUrl: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(issuesRoot, id), { recursive: true });
  writeFileSync(join(issuesRoot, id, "issue.json"), JSON.stringify({ id, ...body }));
}

async function createConversation(): Promise<string> {
  const res = await fetch(`${baseUrl}/api/conversations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: "platform", title: "Attachments chat" }),
  });
  expect(res.status).toBe(201);
  const meta = (await res.json()) as { id: string };
  return meta.id;
}

async function upload(
  conversationId: string,
  filename: string,
  body: Uint8Array | string,
): Promise<Response> {
  const form = new FormData();
  const bytes =
    typeof body === "string" ? new TextEncoder().encode(body) : body;
  form.append("attachment", new Blob([bytes]), filename);
  return fetch(`${baseUrl}/api/conversations/${conversationId}/attachments`, {
    method: "POST",
    body: form,
  });
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-conv-attachments-route-"));
  issuesRoot = join(root, "issues");
  mkdirSync(issuesRoot, { recursive: true });
  workspaceDir = mkdtempSync(join(tmpdir(), "issue-conv-attach-ws-"));
  mkdirSync(join(workspaceDir, ".git"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesRoot);

  writeIssue("platform", {
    kind: "project",
    title: "Platform",
    workspace: workspaceDir,
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
  rmSync(root, { recursive: true, force: true });
  rmSync(workspaceDir, { recursive: true, force: true });
});

describe("conversation attachments HTTP API", () => {
  it("upload then fetch returns the same bytes and content type", async () => {
    const conversationId = await createConversation();
    const payload = "export const x = 1;\n";
    const created = await upload(conversationId, "mock.tsx", payload);
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({
      name: "mock.tsx",
      size: payload.length,
      mimeType: "application/octet-stream",
    });

    const downloaded = await fetch(
      `${baseUrl}/api/conversations/${conversationId}/attachments/mock.tsx`,
    );
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("content-type")).toMatch(
      /application\/octet-stream/,
    );
    expect(await downloaded.text()).toBe(payload);
  });

  it("list and upload responses carry mimeType", async () => {
    const conversationId = await createConversation();
    const pngBytes = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const created = await upload(conversationId, "shot.png", pngBytes);
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({
      name: "shot.png",
      size: pngBytes.length,
      mimeType: "image/png",
    });

    const listed = await fetch(
      `${baseUrl}/api/conversations/${conversationId}/attachments`,
    );
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({
      attachments: [
        { name: "shot.png", size: pngBytes.length, mimeType: "image/png" },
      ],
    });
  });

  it("delete removes an attachment", async () => {
    const conversationId = await createConversation();
    const created = await upload(conversationId, "note.txt", "hello");
    expect(created.status).toBe(201);

    const deleted = await fetch(
      `${baseUrl}/api/conversations/${conversationId}/attachments/note.txt`,
      { method: "DELETE" },
    );
    expect(deleted.status).toBe(204);

    const listed = await fetch(
      `${baseUrl}/api/conversations/${conversationId}/attachments`,
    );
    expect(await listed.json()).toEqual({ attachments: [] });

    const missing = await fetch(
      `${baseUrl}/api/conversations/${conversationId}/attachments/note.txt`,
    );
    expect(missing.status).toBe(404);
  });

  it("rejects oversize uploads with 413", async () => {
    const conversationId = await createConversation();
    const oversize = new Uint8Array(MAX_ATTACHMENT_BYTES + 1);
    const res = await upload(conversationId, "big.bin", oversize);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      error: `attachment exceeds ${MAX_ATTACHMENT_BYTES} byte limit`,
      code: "attachment-too-large",
    });
  });

  it("returns 404 for an unknown conversation", async () => {
    const res = await fetch(`${baseUrl}/api/conversations/ghost/attachments`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'unknown conversation "ghost"',
      code: "not_found",
    });
  });
});
