import * as fs from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-07-09T14:00:00.000Z";
const LONG_AGO = new Date("2026-01-01T00:00:00.000Z");
let dir: string;
let readFileSpy: ReturnType<typeof vi.fn>;

function issueJson(id: string, title: string): string {
  return JSON.stringify({
    id,
    kind: "project",
    title,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
}

function writeIssue(id: string, title: string): string {
  const path = join(dir, id, "issue.json");
  fs.mkdirSync(join(dir, id), { recursive: true });
  fs.writeFileSync(path, issueJson(id, title));
  return path;
}

// Outside the racy window, so an unchanged file is trusted on stats alone.
function writeSettledIssue(id: string, title: string): void {
  fs.utimesSync(writeIssue(id, title), LONG_AGO, LONG_AGO);
}

function issueJsonReads(): number {
  return readFileSpy.mock.calls.filter(([path]) =>
    String(path).endsWith("issue.json"),
  ).length;
}

const VALID_COMMENT = `${JSON.stringify({
  id: "c1",
  role: "agent",
  body: "ok",
  at: AT,
})}\n`;

function writeComments(id: string, body: string): void {
  fs.writeFileSync(join(dir, id, "comments.jsonl"), body);
}

function writeSettledComments(id: string, body: string): void {
  writeComments(id, body);
  fs.utimesSync(join(dir, id, "comments.jsonl"), LONG_AGO, LONG_AGO);
}

function commentsReads(): number {
  return readFileSpy.mock.calls.filter(([path]) =>
    String(path).endsWith("comments.jsonl"),
  ).length;
}

beforeEach(() => {
  dir = fs.mkdtempSync(join(tmpdir(), "issue-tracker-snapshot-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);
  vi.doMock("fs", async (importOriginal) => {
    const actual = await importOriginal<typeof import("fs")>();
    readFileSpy = vi.fn(actual.readFileSync);
    return { ...actual, readFileSync: readFileSpy };
  });
});

afterEach(() => {
  vi.doUnmock("fs");
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("readSnapshot", () => {
  it("reuses the snapshot on an unchanged store without reading any issue.json", async () => {
    writeSettledIssue("a", "A");
    writeSettledIssue("b", "B");
    const { readSnapshot } = await import("./issues-snapshot.js");

    const first = readSnapshot();
    expect(issueJsonReads()).toBe(2);
    const second = readSnapshot();

    expect(second).toBe(first);
    expect(issueJsonReads()).toBe(2);
    expect(second.byId.get("a")?.title).toBe("A");
  });

  it("re-parses only the rewritten issue and changes version", async () => {
    writeSettledIssue("a", "A");
    writeSettledIssue("b", "B");
    const { readSnapshot } = await import("./issues-snapshot.js");
    const first = readSnapshot();

    writeIssue("a", "A renamed");
    const second = readSnapshot();

    expect(second.version).not.toBe(first.version);
    expect(second.byId.get("a")?.title).toBe("A renamed");
    expect(second.byId.get("b")).toBe(first.byId.get("b"));
    expect(issueJsonReads()).toBe(3);
  });

  it("re-reads a recently written issue but keeps version when its content is unchanged", async () => {
    writeIssue("a", "A");
    const { readSnapshot } = await import("./issues-snapshot.js");
    const first = readSnapshot();
    const second = readSnapshot();

    expect(issueJsonReads()).toBe(2);
    expect(second).toBe(first);
  });

  it("sees issues added and removed by another writer", async () => {
    writeSettledIssue("a", "A");
    const { readSnapshot } = await import("./issues-snapshot.js");
    const first = readSnapshot();

    writeIssue("b", "B");
    fs.rmSync(join(dir, "a"), { recursive: true });
    const second = readSnapshot();

    expect(second.version).not.toBe(first.version);
    expect(second.issues.map((issue) => issue.id)).toEqual(["b"]);
    expect(second.byId.has("a")).toBe(false);
  });

  it("surfaces a malformed rewrite instead of the last good copy", async () => {
    writeSettledIssue("a", "A");
    const { readSnapshot } = await import("./issues-snapshot.js");
    readSnapshot();

    fs.writeFileSync(join(dir, "a", "issue.json"), "{ not json");
    const broken = readSnapshot();
    expect(broken.byId.has("a")).toBe(false);
    expect(broken.problems).toEqual([
      expect.objectContaining({ id: "a", message: expect.stringMatching(/^invalid issue\.json/) }),
    ]);

    writeIssue("a", "A fixed");
    const fixed = readSnapshot();
    expect(fixed.byId.get("a")?.title).toBe("A fixed");
    expect(fixed.problems).toEqual([]);
  });

  it("reports a directory without issue.json until one appears", async () => {
    fs.mkdirSync(join(dir, "empty"));
    const { readSnapshot } = await import("./issues-snapshot.js");
    expect(readSnapshot().problems).toEqual([
      { id: "empty", message: "missing issue.json" },
    ]);

    writeIssue("empty", "Now present");
    const snapshot = readSnapshot();
    expect(snapshot.problems).toEqual([]);
    expect(snapshot.byId.get("empty")?.title).toBe("Now present");
  });

  it("freezes shared issues so a caller cannot corrupt later reads", async () => {
    writeSettledIssue("a", "A");
    const { readSnapshot } = await import("./issues-snapshot.js");
    const issue = readSnapshot().byId.get("a")!;

    expect(() => {
      issue.title = "mutated";
    }).toThrow(TypeError);
  });

  it("reuses comment problem results without re-reading an unchanged comments.jsonl", async () => {
    writeSettledIssue("a", "A");
    writeSettledComments("a", "{ not json\n");
    const { readSnapshot } = await import("./issues-snapshot.js");

    const first = readSnapshot();
    expect(commentsReads()).toBe(1);
    const second = readSnapshot();

    expect(second).toBe(first);
    expect(commentsReads()).toBe(1);
    expect(second.commentProblems).toEqual([
      expect.objectContaining({
        id: "a",
        message: expect.stringContaining("comments.jsonl line 1"),
      }),
    ]);
  });

  it("re-parses only the comments file that changed and keeps the issue version", async () => {
    writeSettledIssue("a", "A");
    writeSettledIssue("b", "B");
    writeSettledComments("a", "{ not json\n");
    writeSettledComments("b", "{ not json\n");
    const { readSnapshot } = await import("./issues-snapshot.js");
    const first = readSnapshot();

    writeComments("a", "{ not json\n{ also bad\n");
    const second = readSnapshot();

    expect(second.version).toBe(first.version);
    expect(second.byId.get("a")).toBe(first.byId.get("a"));
    expect(second.byId.get("b")).toBe(first.byId.get("b"));
    expect(commentsReads()).toBe(3);
    expect(second.commentProblems.filter((problem) => problem.id === "a")).toHaveLength(2);
    expect(second.commentProblems.filter((problem) => problem.id === "b")).toEqual(
      first.commentProblems.filter((problem) => problem.id === "b"),
    );
  });

  it("sees a comments append from another writer on the next read", async () => {
    writeSettledIssue("a", "A");
    writeSettledComments("a", VALID_COMMENT);
    const { readSnapshot } = await import("./issues-snapshot.js");
    expect(readSnapshot().commentProblems).toEqual([]);

    fs.appendFileSync(join(dir, "a", "comments.jsonl"), "{ not json\n");
    const next = readSnapshot();

    expect(next.commentProblems).toEqual([
      expect.objectContaining({
        id: "a",
        message: expect.stringContaining("comments.jsonl line 2"),
      }),
    ]);
    expect(commentsReads()).toBe(2);
  });

  it("re-reads a recently written comments file and keeps the snapshot when content is unchanged", async () => {
    writeIssue("a", "A");
    writeComments("a", "{ not json\n");
    const { readSnapshot } = await import("./issues-snapshot.js");
    const first = readSnapshot();
    const second = readSnapshot();

    expect(commentsReads()).toBe(2);
    expect(second).toBe(first);
  });

  it("drops cached comment problems when the file is removed and reports a new one", async () => {
    writeSettledIssue("a", "A");
    writeSettledComments("a", "{ not json\n");
    const { readSnapshot } = await import("./issues-snapshot.js");
    expect(readSnapshot().commentProblems).toHaveLength(1);

    fs.rmSync(join(dir, "a", "comments.jsonl"));
    expect(readSnapshot().commentProblems).toEqual([]);

    writeSettledComments("a", "{ not json\n");
    expect(readSnapshot().commentProblems).toHaveLength(1);
    expect(commentsReads()).toBe(2);
  });

  it("keeps a malformed comments.jsonl off the list until issue.json parses", async () => {
    fs.mkdirSync(join(dir, "bad"));
    writeComments("bad", "{ not json\n");
    const { readSnapshot } = await import("./issues-snapshot.js");

    const broken = readSnapshot();
    expect(broken.commentProblems).toEqual([]);
    expect(commentsReads()).toBe(0);

    writeIssue("bad", "Now valid");
    const fixed = readSnapshot();
    expect(fixed.byId.get("bad")?.title).toBe("Now valid");
    expect(fixed.commentProblems).toEqual([
      expect.objectContaining({ id: "bad" }),
    ]);
    expect(commentsReads()).toBe(1);
  });
});

describe("readAll", () => {
  it("returns arrays the caller owns atop the shared snapshot", async () => {
    writeSettledIssue("a", "A");
    const { readAll } = await import("./issues.js");
    const first = readAll();
    first.issues.pop();

    const second = readAll();
    expect(second.issues.map((issue) => issue.id)).toEqual(["a"]);
    expect(second.issues).not.toBe(first.issues);
  });
});
