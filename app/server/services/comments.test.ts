import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-07-09T14:00:00.000Z";
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
});
