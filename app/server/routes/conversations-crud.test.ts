import { existsSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  baseUrl,
  conversationsDir,
  useConversationsTestFixtures,
} from "./conversations.test-harness.js";

useConversationsTestFixtures();

describe("conversations HTTP API (CRUD)", () => {
  it("POST creates a conversation for a workspace-backed project", async () => {
    const res = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "platform",
        title: "SDK chat",
        model: "composer-2.5",
      }),
    });
    expect(res.status).toBe(201);
    const meta = await res.json();
    expect(meta.projectId).toBe("platform");
    expect(meta.title).toBe("SDK chat");
    expect(meta.model).toBe("composer-2.5");
    expect(existsSync(join(conversationsDir(), meta.id, "meta.json"))).toBe(true);
  });

  it("POST rejects a workspaceless project with 400", async () => {
    const res = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "no-ws" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Project workspace is not set",
      code: "validation",
    });
  });

  it("GET lists conversations and GET /:id returns meta + transcript", async () => {
    const created = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Listed" }),
    }).then((r) => r.json());

    const list = await fetch(`${baseUrl}/api/conversations`).then((r) => r.json());
    expect(list.some((m: { id: string }) => m.id === created.id)).toBe(true);

    const detail = await fetch(`${baseUrl}/api/conversations/${created.id}`).then(
      (r) => r.json(),
    );
    expect(detail.meta.id).toBe(created.id);
    expect(detail.transcript).toEqual([]);
  });

  it("PATCH renames and updates the model", async () => {
    const created = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Before" }),
    }).then((r) => r.json());

    const patched = await fetch(`${baseUrl}/api/conversations/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "After", model: "composer-2.5" }),
    });
    expect(patched.status).toBe(200);
    const meta = await patched.json();
    expect(meta.title).toBe("After");
    expect(meta.model).toBe("composer-2.5");
  });

  it("PATCH archives a conversation and rejects a non-boolean archived value", async () => {
    const created = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Archive via API" }),
    }).then((r) => r.json());

    const bad = await fetch(`${baseUrl}/api/conversations/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ archived: "true" }),
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "archived must be a boolean" });

    const patched = await fetch(`${baseUrl}/api/conversations/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ archived: true });
    expect(
      existsSync(join(conversationsDir(), created.id, "meta.json")),
    ).toBe(true);
  });

  it("GET omits issue-anchored conversations with and without showArchived", async () => {
    const unanchored = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Free-form chat" }),
    }).then((r) => r.json());
    const anchored = await fetch(
      `${baseUrl}/api/issues/capture/channels/planning/sessions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "composer-2.5", title: "Anchored chat" }),
      },
    ).then((r) => r.json());

    const defaultList = await fetch(`${baseUrl}/api/conversations`).then((r) =>
      r.json(),
    );
    expect(defaultList.map((m: { id: string }) => m.id)).toEqual([unanchored.id]);

    const archivedList = await fetch(
      `${baseUrl}/api/conversations?showArchived=true`,
    ).then((r) => r.json());
    expect(archivedList.map((m: { id: string }) => m.id)).toEqual([
      unanchored.id,
    ]);
    expect(archivedList.some((m: { id: string }) => m.id === anchored.id)).toBe(
      false,
    );
  });

  it("GET omits archived conversations unless showArchived=true", async () => {
    const visible = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Visible chat" }),
    }).then((r) => r.json());
    const hidden = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Hidden chat" }),
    }).then((r) => r.json());

    await fetch(`${baseUrl}/api/conversations/${hidden.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });

    const defaultList = await fetch(`${baseUrl}/api/conversations`).then((r) =>
      r.json(),
    );
    expect(defaultList.map((m: { id: string }) => m.id)).toEqual([visible.id]);

    const allList = await fetch(
      `${baseUrl}/api/conversations?showArchived=true`,
    ).then((r) => r.json());
    expect(allList.map((m: { id: string }) => m.id).sort()).toEqual(
      [visible.id, hidden.id].sort(),
    );
  });

  it("DELETE removes the conversation directory", async () => {
    const created = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Delete me" }),
    }).then((r) => r.json());

    const res = await fetch(`${baseUrl}/api/conversations/${created.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(204);
    expect(existsSync(join(conversationsDir(), created.id))).toBe(false);
  });

  it("GET /:id/run reports idle state and list includes activeRun: false", async () => {
    const created = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Idle run state" }),
    }).then((r) => r.json());

    const runRes = await fetch(`${baseUrl}/api/conversations/${created.id}/run`);
    expect(runRes.status).toBe(200);
    expect(await runRes.json()).toEqual({
      active: false,
      runId: null,
      startedAt: null,
    });

    const list = await fetch(`${baseUrl}/api/conversations`).then((r) => r.json());
    const item = list.find((m: { id: string }) => m.id === created.id);
    expect(item?.activeRun).toBe(false);
  });

  it("GET /:id/run returns 404 for an unknown conversation id", async () => {
    const res = await fetch(`${baseUrl}/api/conversations/unknown-conversation/run`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'unknown conversation "unknown-conversation"',
      code: "not_found",
    });
  });

  it("POST without message creates an idle conversation with an empty transcript", async () => {
    const created = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "platform",
        title: "Idle create",
        model: "composer-2.5",
      }),
    });
    expect(created.status).toBe(201);
    const meta = await created.json();

    const run = await fetch(`${baseUrl}/api/conversations/${meta.id}/run`).then(
      (r) => r.json(),
    );
    expect(run).toEqual({
      active: false,
      runId: null,
      startedAt: null,
    });

    const detail = await fetch(`${baseUrl}/api/conversations/${meta.id}`).then(
      (r) => r.json(),
    );
    expect(detail.transcript).toEqual([]);
  });
});
