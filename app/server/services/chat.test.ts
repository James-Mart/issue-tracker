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
let dir: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function writeChat(id: string, contents: string): void {
  writeFileSync(join(dir, id, "chat.jsonl"), contents);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-chat-"));
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

describe("appendMessage", () => {
  it("appends one JSONL line stamped with an ISO `at`", async () => {
    const { appendMessage, readChat } = await loadService();
    const message = await appendMessage("e", { role: "agent", body: "hello" });

    expect(message.role).toBe("agent");
    expect(message.body).toBe("hello");
    expect(Number.isNaN(Date.parse(message.at))).toBe(false);

    const raw = readFileSync(join(dir, "e", "chat.jsonl"), "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw.trim().split("\n")).toHaveLength(1);

    const chat = readChat("e");
    expect(chat.messages).toHaveLength(1);
    expect(chat.messages[0]?.body).toBe("hello");
    expect(chat.problems).toHaveLength(0);
  });

  it("keeps an optional name and omits it when absent", async () => {
    const { appendMessage, readChat } = await loadService();
    await appendMessage("e", { role: "human", name: "Ada", body: "hi" });
    await appendMessage("e", { role: "agent", body: "yo" });
    const chat = readChat("e");
    expect(chat.messages[0]?.name).toBe("Ada");
    expect(chat.messages[1]?.name).toBeUndefined();
  });

  it("rejects an empty body", async () => {
    const { appendMessage } = await loadService();
    await expect(appendMessage("e", { role: "agent", body: "" })).rejects.toThrow(
      /body/i,
    );
  });

  it("throws for an unknown issue", async () => {
    const { appendMessage } = await loadService();
    await expect(
      appendMessage("ghost", { role: "agent", body: "x" }),
    ).rejects.toThrow(/unknown issue/);
  });

  it("appends chat on an Idea and creates chat.jsonl", async () => {
    writeIssue("idea-1", {
      kind: "idea",
      title: "Capture",
      partOf: "e",
      order: 0,
      archived: false,
      createdAt: AT,
      updatedAt: AT,
    });
    const { appendMessage, readChat } = await loadService();
    const message = await appendMessage("idea-1", {
      role: "stakeholder",
      body: "audit note",
    });

    expect(message.role).toBe("stakeholder");
    expect(message.body).toBe("audit note");
    expect(existsSync(join(dir, "idea-1", "chat.jsonl"))).toBe(true);

    const chat = readChat("idea-1");
    expect(chat.messages).toHaveLength(1);
    expect(chat.messages[0]?.body).toBe("audit note");
    expect(chat.problems).toHaveLength(0);
  });

  it("does not interleave concurrent appends", async () => {
    const { appendMessage, readChat } = await loadService();
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        appendMessage("e", { role: "agent", body: `m${i}` }),
      ),
    );
    const chat = readChat("e");
    expect(chat.messages).toHaveLength(25);
    expect(chat.problems).toHaveLength(0);
    const bodies = new Set(chat.messages.map((m) => m.body));
    expect(bodies.size).toBe(25);
  });
});

describe("readChat", () => {
  it("skips malformed lines into problems and never crashes", async () => {
    const { readChat } = await loadService();
    writeChat(
      "e",
      [
        JSON.stringify({ role: "agent", body: "ok", at: AT }),
        "{ not json",
        JSON.stringify({ role: "agent", at: AT }),
        "",
        JSON.stringify({ role: "human", name: "Ada", body: "hey", at: AT }),
      ].join("\n"),
    );

    const chat = readChat("e");
    expect(chat.messages.map((m) => m.body)).toEqual(["ok", "hey"]);
    expect(chat.problems).toHaveLength(2);
    expect(chat.problems[0]?.message).toContain("line 2");
    expect(chat.problems[1]?.message).toContain("line 3");
  });

  it("returns empty for an issue without chat.jsonl", async () => {
    const { readChat } = await loadService();
    expect(readChat("e")).toEqual({ messages: [], problems: [] });
  });

  it("throws for an unknown issue", async () => {
    const { readChat } = await loadService();
    expect(() => readChat("ghost")).toThrow(/unknown issue/);
  });
});
