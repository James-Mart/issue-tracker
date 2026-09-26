import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseComment, parseIssue } from "../schemas.js";

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

describe("request format", () => {
  it("names the first bad item and ignores a later one", async () => {
    const { requestFormatError } = await load();
    const error = requestFormatError(
      [
        "- Input: the public webhook URL",
        "- Secret `not-a-key`: the key",
        "- Observation: look at the page",
      ].join("\n"),
    );
    expect(error).toBe(
      "request item does not follow the Request format: Secret `not-a-key`: the key",
    );
    expect(error).not.toContain("Observation");
  });

  it("names a non-bullet line", async () => {
    const { requestFormatError } = await load();
    expect(requestFormatError("Please set the key\n- Input: x")).toBe(
      "request item does not follow the Request format: Please set the key",
    );
  });

  it("refuses an empty body", async () => {
    const { requestFormatError } = await load();
    expect(requestFormatError("")).toBe("request body has no items");
    expect(requestFormatError("\n\n")).toBe("request body has no items");
  });
});

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

  it("refuses a bad body without writing", async () => {
    const { requestHuman } = await load();
    await expect(requestHuman("s", "- Input:")).rejects.toThrow(
      /request item does not follow the Request format: Input:/,
    );
    expect(readStored("s").review).toBeUndefined();
    expect(existsSync(join(dir, "s", "comments.jsonl"))).toBe(false);
  });

  it("refuses when review is already awaiting-human", async () => {
    const { requestHuman } = await load();
    await requestHuman("s", REQUEST);
    await expect(requestHuman("s", REQUEST)).rejects.toThrow(
      /review is already awaiting-human/,
    );
    expect(readCommentLines("s")).toHaveLength(1);
    expect(readStored("s").review).toBe("awaiting-human");
  });

  it("refuses a task", async () => {
    writeIssue("t", {
      kind: "task",
      title: "Task",
      partOf: "s",
      status: "todo",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    const { requestHuman } = await load();
    await expect(requestHuman("t", REQUEST)).rejects.toThrow(
      /"t" is a task, not a story/,
    );
  });
});

describe("humanDone", () => {
  it("replies to the latest human-request and clears review", async () => {
    const { humanDone, requestHuman } = await load();
    const first = await requestHuman("s", REQUEST);
    await humanDone("s", "set the key");
    const second = await requestHuman("s", "- Observation: the page is green");
    const reply = await humanDone("s");

    expect(reply.role).toBe("human");
    expect(reply.type).toBe("human-response");
    expect(reply.replyTo).toBe(second.id);
    expect(reply.replyTo).not.toBe(first.id);
    expect(reply.body).toBe("");
    expect(readStored("s").review).toBeUndefined();

    const lines = readCommentLines("s");
    const storedReply = lines.find((line) => line.id === reply.id);
    expect(storedReply).toMatchObject({
      role: "human",
      type: "human-response",
      body: "",
      replyTo: second.id,
    });
  });

  it("stores the note as the response body", async () => {
    const { humanDone, requestHuman } = await load();
    const request = await requestHuman("s", REQUEST);
    const reply = await humanDone("s", "webhook is https://example.test/hook");
    expect(reply.body).toBe("webhook is https://example.test/hook");
    expect(reply.replyTo).toBe(request.id);
    expect(readStored("s").review).toBeUndefined();
  });

  it("refuses when review is not awaiting-human", async () => {
    const { humanDone } = await load();
    await expect(humanDone("s", "note")).rejects.toThrow(
      /review is not awaiting-human/,
    );
    expect(existsSync(join(dir, "s", "comments.jsonl"))).toBe(false);

    story({ review: "passed" });
    await expect(humanDone("s")).rejects.toThrow(/review is not awaiting-human/);
    expect(readStored("s").review).toBe("passed");
  });

  it("refuses awaiting-human with no human-request comment", async () => {
    story({ review: "awaiting-human" });
    const { humanDone } = await load();
    await expect(humanDone("s")).rejects.toThrow(/no human-request comment/);
    expect(readStored("s").review).toBe("awaiting-human");
  });
});

describe("schema", () => {
  const branch = {
    id: "s",
    kind: "story",
    title: "Story",
    partOf: "p",
    createdAt: AT,
    updatedAt: AT,
  };

  it("accepts awaiting-human and still rejects an unknown review", () => {
    const parsed = parseIssue({ ...branch, review: "awaiting-human" });
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.issue.kind === "story") {
      expect(parsed.issue.review).toBe("awaiting-human");
    }
    expect(parseIssue({ ...branch, review: "pending" }).ok).toBe(false);
  });

  it("allows an empty body only on a human-response", () => {
    const base = {
      id: "c1",
      role: "human",
      at: AT,
      body: "",
    };
    expect(parseComment({ ...base, type: "human-response" }).ok).toBe(true);
    expect(parseComment(base).ok).toBe(false);
    expect(parseComment({ ...base, type: "human-request" }).ok).toBe(false);
    expect(parseComment({ ...base, body: "x", type: "other" }).ok).toBe(false);
  });
});
