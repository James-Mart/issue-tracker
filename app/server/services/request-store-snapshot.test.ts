import { ChildProcess, type ChildProcessByStdio } from "node:child_process";
import { PassThrough, type Readable } from "node:stream";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import type { Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitSpawner } from "./git-read.js";

const AT = "2026-07-09T14:00:00.000Z";
const AT_LATER = "2026-07-09T15:00:00.000Z";
const SHA = "0123456789abcdef0123456789abcdef01234567";
const PARENT = "abcdefabcdefabcdefabcdefabcdefabcdefabcd";
const REVIEW_ID = "rev-1";

let root: string;
let issuesDir: string;
let server: Server;
let baseUrl: string;
let readAllSpy: { mockClear: () => void; mock: { calls: unknown[] } };

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(issuesDir, id), { recursive: true });
  writeFileSync(join(issuesDir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function writeConversation(id: string, createdAt: string): void {
  const dir = join(root, "conversations", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "meta.json"),
    JSON.stringify({
      id,
      title: id,
      projectId: "p",
      model: "composer-2.5",
      issueId: "s",
      channel: "review",
      createdAt,
      updatedAt: createdAt,
    }),
  );
}

function gitResult(args: string[]): { code: number; stdout: string } {
  if (args[0] === "remote") return { code: 1, stdout: "" };
  if (args[0] === "rev-parse") return { code: 0, stdout: `${PARENT}\n` };
  if (args[0] === "rev-list") return { code: 0, stdout: "1\n" };
  if (args[0] === "show") {
    const format = args.find((arg) => arg.startsWith("--format=")) ?? "";
    if (format.includes("%an")) return { code: 0, stdout: `Tester\0${AT}\0subject\n` };
    if (format.includes("%s")) return { code: 0, stdout: "subject\n" };
    return { code: 0, stdout: "hello\n" };
  }
  if (args[0] === "diff") {
    if (args.includes("--shortstat")) {
      return { code: 0, stdout: " 1 file changed, 1 insertion(+)\n" };
    }
    return { code: 0, stdout: "" };
  }
  return { code: 1, stdout: "" };
}

function mockGitChild(stdout: string, code: number): ChildProcessByStdio<null, Readable, Readable> {
  const out = new PassThrough();
  const err = new PassThrough();
  const child = Object.assign(new ChildProcess(), {
    stdin: null,
    stdout: out,
    stderr: err,
    stdio: [null, out, err, undefined, undefined] as const,
  });
  setImmediate(() => {
    if (stdout) child.stdout.emit("data", stdout);
    child.emit("close", code);
  });
  return child;
}

async function expectOneSnapshot(
  path: string,
): Promise<Record<string, unknown>> {
  readAllSpy.mockClear();
  const res = await fetch(`${baseUrl}${path}`);
  const body = (await res.json()) as Record<string, unknown>;
  expect(res.status, JSON.stringify(body)).toBe(200);
  expect(readAllSpy.mock.calls).toHaveLength(1);
  return body;
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-one-snapshot-"));
  issuesDir = join(root, "issues");
  mkdirSync(issuesDir, { recursive: true });
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesDir);
  vi.stubEnv("ISSUE_TRACKER_STORE_READ_ONLY", "");

  writeIssue("p", {
    kind: "project",
    title: "P",
    workspace: "/repo/root",
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
  writeIssue("s", {
    kind: "story",
    title: "S",
    partOf: "e",
    merged: false,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("t", {
    kind: "task",
    title: "T",
    partOf: "s",
    commits: [SHA],
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  mkdirSync(join(issuesDir, "p", "reviews"), { recursive: true });
  writeFileSync(
    join(issuesDir, "p", "reviews", `${REVIEW_ID}.json`),
    `${JSON.stringify({
      id: REVIEW_ID,
      projectId: "p",
      target: { kind: "story", storyId: "s" },
      status: "open",
      postMortem: false,
      createdAt: AT,
      updatedAt: AT,
      marks: { all: {}, commits: {} },
      submissions: [
        {
          id: "sub-a",
          at: AT,
          threadIds: ["thread-a"],
          conversationId: "conv-a",
          status: "done",
          taskIds: ["t"],
        },
        {
          id: "sub-b",
          at: AT_LATER,
          threadIds: ["thread-b"],
          conversationId: "conv-b",
          status: "done",
          taskIds: ["t"],
        },
      ],
    })}\n`,
  );
  writeConversation("conv-a", AT);
  writeConversation("conv-b", AT_LATER);

  const { refreshStorePathsFromEnv } = await import("../config.js");
  refreshStorePathsFromEnv();
  const { setGitSpawnerForTests } = await import("./git-read.js");
  const spawner: GitSpawner = (_command, args) => {
    const result = gitResult(args);
    return mockGitChild(result.stdout, result.code);
  };
  setGitSpawnerForTests(spawner);

  const { createApp } = await import("../app.js");
  const issues = await import("./issues.js");
  readAllSpy = vi.spyOn(issues, "readAll");
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("expected TCP listen address");
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  const { setGitSpawnerForTests } = await import("./git-read.js");
  setGitSpawnerForTests(null);
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
  rmSync(root, { recursive: true, force: true });
});

describe("one store snapshot per review and change request", () => {
  it("loads the store once for a story change", async () => {
    const body = await expectOneSnapshot("/api/issues/s/change");
    expect(body).toMatchObject({ state: "loaded" });
  });

  it("loads the store once for a story change file", async () => {
    const body = await expectOneSnapshot(
      `/api/issues/s/change/file?path=src/a.txt&sha=${SHA}`,
    );
    expect(body).toEqual({ contents: "hello\n" });
  });

  it("loads the store once for the reviews list, including each mark index", async () => {
    const body = await expectOneSnapshot("/api/projects/p/reviews");
    expect(body).toMatchObject({
      reviews: [{ id: REVIEW_ID, progress: { all: { total: 0 } } }],
    });
  });

  it("loads the store once for review commits", async () => {
    const body = await expectOneSnapshot(`/api/projects/p/reviews/${REVIEW_ID}/commits`);
    expect(body).toMatchObject({
      commits: [{ sha: SHA, subject: "subject" }],
    });
  });

  it("loads the store once for a review diff", async () => {
    const body = await expectOneSnapshot(
      `/api/projects/p/reviews/${REVIEW_ID}/diff?scope=all`,
    );
    expect(body).toMatchObject({ scope: "all", files: [] });
  });

  it("loads the store once for a review and its mark index", async () => {
    const body = await expectOneSnapshot(`/api/projects/p/reviews/${REVIEW_ID}`);
    expect(body).toMatchObject({
      id: REVIEW_ID,
      progress: { all: { total: 0 } },
    });
  });

  it("loads the store once for agent runs across review-channel conversations", async () => {
    const body = await expectOneSnapshot("/api/issues/s/agent-runs");
    const runs = body.runs as { conversationId: string }[];
    expect(runs.map((run) => run.conversationId)).toEqual(["conv-a", "conv-b"]);
  });
});
