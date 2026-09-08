import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-07-09T14:00:00.000Z";
const COMMIT_SHA = "deadbeef00000000000000000000000000000000";
let dir: string;

function storedComment(
  overrides: Record<string, unknown> & { id: string; role: string; body: string },
): string {
  return JSON.stringify({ at: AT, ...overrides });
}

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function writeComments(id: string, contents: string): void {
  writeFileSync(join(dir, id, "comments.jsonl"), contents);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-comments-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);
  writeIssue("e", { kind: "project", title: "E", createdAt: AT, updatedAt: AT });
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

async function loadService() {
  return import("./issues.js");
}

describe("appendComment", () => {
  it("appends one JSONL line stamped with an ISO `at` and generated `id`", async () => {
    const { appendComment, readComments } = await loadService();
    const message = await appendComment("e", { role: "agent", body: "hello" });

    expect(message.role).toBe("agent");
    expect(message.body).toBe("hello");
    expect(message.id.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(message.at))).toBe(false);

    const raw = readFileSync(join(dir, "e", "comments.jsonl"), "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    const stored = JSON.parse(raw.trim());
    expect(stored.id).toBe(message.id);
    expect(stored.at).toBe(message.at);

    const comments = readComments("e");
    expect(comments.messages).toHaveLength(1);
    expect(comments.messages[0]?.body).toBe("hello");
    expect(comments.messages[0]?.id).toBe(message.id);
    expect(comments.problems).toHaveLength(0);
  });

  it("keeps an optional name and omits it when absent", async () => {
    const { appendComment, readComments } = await loadService();
    await appendComment("e", { role: "human", name: "Ada", body: "hi" });
    await appendComment("e", { role: "agent", body: "yo" });
    const comments = readComments("e");
    expect(comments.messages[0]?.name).toBe("Ada");
    expect(comments.messages[1]?.name).toBeUndefined();
  });

  it("rejects an empty body", async () => {
    const { appendComment } = await loadService();
    await expect(appendComment("e", { role: "agent", body: "" })).rejects.toThrow(
      /body/i,
    );
  });

  it("throws for an unknown issue", async () => {
    const { appendComment } = await loadService();
    await expect(
      appendComment("ghost", { role: "agent", body: "x" }),
    ).rejects.toThrow(/unknown issue/);
  });

  it("appends comments on an Idea and creates comments.jsonl", async () => {
    writeIssue("idea-1", {
      kind: "idea",
      title: "Capture",
      partOf: "e",
      order: 0,
      archived: false,
      createdAt: AT,
      updatedAt: AT,
    });
    const { appendComment, readComments } = await loadService();
    const message = await appendComment("idea-1", {
      role: "stakeholder",
      body: "audit note",
    });

    expect(message.role).toBe("stakeholder");
    expect(message.body).toBe("audit note");
    expect(existsSync(join(dir, "idea-1", "comments.jsonl"))).toBe(true);

    const comments = readComments("idea-1");
    expect(comments.messages).toHaveLength(1);
    expect(comments.messages[0]?.body).toBe("audit note");
    expect(comments.problems).toHaveLength(0);
  });

  it("does not interleave concurrent appends", async () => {
    const { appendComment, readComments } = await loadService();
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        appendComment("e", { role: "agent", body: `m${i}` }),
      ),
    );
    const comments = readComments("e");
    expect(comments.messages).toHaveLength(25);
    expect(comments.problems).toHaveLength(0);
    const bodies = new Set(comments.messages.map((m) => m.body));
    expect(bodies.size).toBe(25);
  });

  it("appends an anchored comment and returns its id", async () => {
    const { appendComment, readComments } = await loadService();
    const message = await appendComment("e", {
      role: "agent",
      body: "on this line",
      anchor: {
        path: "app/server/services/issues.ts",
        side: "new",
        line: 42,
        startLine: 40,
        commitSha: COMMIT_SHA,
      },
    });

    expect(message.id.length).toBeGreaterThan(0);
    expect(message.anchor).toEqual({
      path: "app/server/services/issues.ts",
      side: "new",
      line: 42,
      startLine: 40,
      commitSha: COMMIT_SHA,
    });

    const comments = readComments("e");
    expect(comments.messages).toHaveLength(1);
    expect(comments.messages[0]?.anchor).toEqual(message.anchor);
  });

  it("appends a reply to a thread root and returns its id", async () => {
    const { appendComment, readComments } = await loadService();
    const root = await appendComment("e", { role: "agent", body: "root" });
    const reply = await appendComment("e", {
      role: "human",
      body: "reply",
      replyTo: root.id,
    });

    expect(reply.replyTo).toBe(root.id);
    expect(reply.id).not.toBe(root.id);

    const comments = readComments("e");
    expect(comments.messages).toHaveLength(2);
    expect(comments.messages[1]?.replyTo).toBe(root.id);
  });

  it("refuses replyTo naming a comment that does not exist", async () => {
    const { appendComment } = await loadService();
    await expect(
      appendComment("e", {
        role: "agent",
        body: "orphan reply",
        replyTo: "missing-id",
      }),
    ).rejects.toThrow(/unknown comment/);
  });

  it("refuses replyTo naming a reply (threads are one level deep)", async () => {
    const { appendComment } = await loadService();
    const root = await appendComment("e", { role: "agent", body: "root" });
    const reply = await appendComment("e", {
      role: "human",
      body: "first reply",
      replyTo: root.id,
    });
    await expect(
      appendComment("e", {
        role: "human",
        body: "nested reply",
        replyTo: reply.id,
      }),
    ).rejects.toThrow(/thread root/);
  });

  it("refuses replyTo together with anchor on the same comment", async () => {
    const { appendComment } = await loadService();
    const root = await appendComment("e", { role: "agent", body: "root" });
    await expect(
      appendComment("e", {
        role: "human",
        body: "conflict",
        replyTo: root.id,
        anchor: {
          path: "app/server/services/issues.ts",
          side: "new",
          line: 1,
          commitSha: COMMIT_SHA,
        },
      }),
    ).rejects.toThrow(/replyTo and anchor/);
  });

  it("refuses anchor.startLine greater than anchor.line", async () => {
    const { appendComment } = await loadService();
    await expect(
      appendComment("e", {
        role: "agent",
        body: "bad range",
        anchor: {
          path: "app/server/services/issues.ts",
          side: "new",
          line: 10,
          startLine: 20,
          commitSha: COMMIT_SHA,
        },
      }),
    ).rejects.toThrow(/startLine.*greater than.*line/i);
  });
});

describe("readComments", () => {
  it("skips malformed lines into problems and never crashes", async () => {
    const { readComments } = await loadService();
    writeComments(
      "e",
      [
        storedComment({ id: "c1", role: "agent", body: "ok" }),
        "{ not json",
        JSON.stringify({ id: "c2", role: "agent", at: AT }),
        "",
        storedComment({ id: "c3", role: "human", name: "Ada", body: "hey" }),
      ].join("\n"),
    );

    const comments = readComments("e");
    expect(comments.messages.map((m) => m.body)).toEqual(["ok", "hey"]);
    expect(comments.problems).toHaveLength(2);
    expect(comments.problems[0]?.message).toContain("line 2");
    expect(comments.problems[1]?.message).toContain("line 3");
  });

  it("returns empty for an issue without comments.jsonl", async () => {
    const { readComments } = await loadService();
    expect(readComments("e")).toEqual({ messages: [], problems: [] });
  });

  it("throws for an unknown issue", async () => {
    const { readComments } = await loadService();
    expect(() => readComments("ghost")).toThrow(/unknown issue/);
  });
});

describe("list legacy chat.jsonl", () => {
  it("reports a surviving chat.jsonl beside an issue as a problem", async () => {
    writeFileSync(join(dir, "e", "chat.jsonl"), '{"role":"agent","body":"x","at":"t"}\n');
    const { list } = await loadService();
    const problems = list().problems.filter((p) => p.id === "e");
    expect(problems.some((p) => p.message === "chat.jsonl")).toBe(true);
  });
});
