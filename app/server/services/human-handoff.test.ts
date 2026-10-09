import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-07-09T14:00:00.000Z";
const REQUEST = [
  "- Secret `API_KEY`: sandbox key from the vendor",
  "- Input: the public webhook URL",
  "* Observation: whether the dashboard shows green",
].join("\n");

let dir: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function story(extra: Record<string, unknown> = {}): void {
  writeIssue("s", {
    kind: "story",
    title: "Story",
    partOf: "p",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  });
}

function readStored(id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, id, "issue.json"), "utf8"));
}

function readCommentLines(id: string): Record<string, unknown>[] {
  const path = join(dir, id, "comments.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-human-handoff-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);
  writeIssue("p", {
    kind: "project",
    title: "P",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  story();
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

async function load() {
  return import("./human-handoff.js");
}

describe("requestHuman", () => {
  it("posts a thread-root human-request and sets review", async () => {
    const { requestHuman } = await load();
    const message = await requestHuman("s", `${REQUEST}\n`);

    expect(message.role).toBe("story-review");
    expect(message.type).toBe("human-request");
    expect(message.replyTo).toBeUndefined();
    expect(message.body).toBe(REQUEST);
    expect(readStored("s").review).toBe("awaiting-human");

    const stored = readCommentLines("s");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      id: message.id,
      role: "story-review",
      type: "human-request",
      body: REQUEST,
    });
    expect(stored[0]?.replyTo).toBeUndefined();
  });
});
