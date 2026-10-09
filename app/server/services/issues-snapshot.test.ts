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
});
