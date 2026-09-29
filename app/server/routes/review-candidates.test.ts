import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import type { Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-07-09T14:00:00.000Z";

let dir: string;
let repo: string;
let server: Server;
let baseUrl: string;
let n = 0;

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "Tester",
  GIT_AUTHOR_EMAIL: "tester@example.com",
  GIT_COMMITTER_NAME: "Tester",
  GIT_COMMITTER_EMAIL: "tester@example.com",
};

const dates = {
  t0: "2026-06-01T00:00:00Z",
  t1: "2026-07-01T00:00:00Z",
  t2: "2026-07-02T00:00:00Z",
  t3: "2026-07-03T00:00:00Z",
  t4: "2026-07-04T00:00:00Z",
  t5: "2026-07-05T00:00:00Z",
  t6: "2026-07-06T00:00:00Z",
  t7: "2026-07-07T00:00:00Z",
};

type Candidate = {
  storyId: string;
  title: string;
  merged: boolean;
  reviewId?: string;
  lastCommitAt: string;
};

function git(args: string[], env: NodeJS.ProcessEnv = gitEnv): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", env });
}

function commitAt(iso: string): string {
  n += 1;
  const name = `f${n}.txt`;
  writeFileSync(join(repo, name), `${iso}\n`);
  git(["add", name]);
  git(["commit", "-m", name], {
    ...gitEnv,
    GIT_AUTHOR_DATE: iso,
    GIT_COMMITTER_DATE: iso,
  });
  return git(["rev-parse", "HEAD"]).trim();
}

function initRepo(): void {
  n = 0;
  repo = mkdtempSync(join(tmpdir(), "issue-tracker-candidates-repo-"));
  git(["init", "-b", "main"]);
}

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function story(id: string, title: string, order: number, merged = false): void {
  writeIssue(id, {
    kind: "story",
    title,
    partOf: "e",
    order,
    merged,
    createdAt: AT,
    updatedAt: AT,
  });
}

function task(id: string, partOf: string, commits: string[], noDiff = false): void {
  writeIssue(id, {
    kind: "task",
    title: id,
    partOf,
    commits,
    ...(noDiff ? { noDiff: true } : {}),
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
}

function writeReview(id: string, storyId: string): void {
  const reviews = join(dir, "p", "reviews");
  mkdirSync(reviews, { recursive: true });
  writeFileSync(
    join(reviews, `${id}.json`),
    JSON.stringify({
      id,
      projectId: "p",
      target: { kind: "story", storyId },
      status: "open",
      postMortem: false,
      createdAt: AT,
      updatedAt: AT,
      marks: { all: {}, commits: {} },
    }),
  );
}

function seed(shas: Record<keyof typeof dates, string>): void {
  writeIssue("p", {
    kind: "project",
    title: "P",
    workspace: repo,
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
  story("s-new", "Newest surface", 0);
  task("t-new", "s-new", [shas.t7]);
  writeReview("rev-new", "s-new");

  story("s-two", "Two commits", 1);
  task("t-two", "s-two", [shas.t1, shas.t6]);

  story("s-mid", "Middle delegate", 2);
  task("t-mid", "s-mid", [shas.t5]);

  story("s-merged", "Merged metrics", 3, true);
  task("t-merged", "s-merged", [shas.t4]);
  writeReview("rev-merged", "s-merged");

  story("s-fifth", "Fifth export", 4);
  task("t-fifth", "s-fifth", [shas.t3]);

  story("s-sixth", "Sixth outside cockpit", 5);
  task("t-sixth", "s-sixth", [shas.t2]);

  story("s-old", "Alpha outside lattice", 6);
  task("t-old", "s-old", [shas.t0]);

  story("s-empty", "Lattice draft", 7);
  task("t-empty", "s-empty", []);

  story("s-nodiff", "Nodiff lattice", 8);
  task("t-nodiff", "s-nodiff", [shas.t7], true);

  story("s-gone", "Missing object", 9);
  task("t-gone", "s-gone", ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);

  story("s-mixed", "Mixed reach", 10);
  task("t-mixed", "s-mixed", [shas.t3, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]);

  writeIssue("q", {
    kind: "project",
    title: "Q",
    order: 1,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("s-foreign", {
    kind: "story",
    title: "Foreign lattice",
    partOf: "q",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  task("t-foreign", "s-foreign", [shas.t7]);
}

async function listen(): Promise<void> {
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
}

async function closeServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function candidates(search: string): Promise<Candidate[]> {
  const res = await fetch(`${baseUrl}/api/projects/p/review-candidates${search}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { stories: Candidate[] };
  return body.stories;
}

describe("review candidates API", () => {
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "issue-tracker-candidates-"));
    initRepo();
    const shas = {
      t0: commitAt(dates.t0),
      t1: commitAt(dates.t1),
      t2: commitAt(dates.t2),
      t3: commitAt(dates.t3),
      t4: commitAt(dates.t4),
      t5: commitAt(dates.t5),
      t6: commitAt(dates.t6),
      t7: commitAt(dates.t7),
    };
    vi.resetModules();
    vi.stubEnv("ISSUES_DIR", dir);
    seed(shas);
    await listen();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await closeServer();
    rmSync(dir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it("orders by newest committer date and limits an empty query", async () => {
    const top = await candidates("?limit=5");
    expect(top.map((story) => story.storyId)).toEqual([
      "s-new",
      "s-two",
      "s-mid",
      "s-merged",
      "s-fifth",
    ]);
    expect(top[1]?.lastCommitAt).toBe(dates.t6);
    expect(top[0]?.reviewId).toBe("rev-new");
    expect(top[1]).not.toHaveProperty("reviewId");
    expect(top[3]).toMatchObject({ merged: true, reviewId: "rev-merged" });

    const two = await candidates("?limit=2");
    expect(two.map((story) => story.storyId)).toEqual(["s-new", "s-two"]);
  });

  it("returns every title match past the empty-query limit, including merged stories", async () => {
    const outside = await candidates("?query=outside&limit=1");
    expect(outside.map((story) => story.storyId)).toEqual(["s-sixth", "s-old"]);

    const lattice = await candidates("?query=LATTICE");
    expect(lattice.map((story) => story.storyId)).toEqual(["s-old"]);

    const merged = await candidates("?query=metrics");
    expect(merged).toEqual([
      expect.objectContaining({
        storyId: "s-merged",
        merged: true,
        reviewId: "rev-merged",
      }),
    ]);
  });

  it("omits stories without commits", async () => {
    const all = await candidates("?limit=20");
    const ids = all.map((story) => story.storyId);
    expect(ids).not.toContain("s-empty");
    expect(ids).not.toContain("s-nodiff");
    expect(ids).not.toContain("s-foreign");
    expect(ids).not.toContain("s-gone");
    expect(all.find((story) => story.storyId === "s-mixed")?.lastCommitAt).toBe(dates.t3);
    expect(ids).toHaveLength(8);
  });

  it("requires a positive limit when the query is empty", async () => {
    const missing = await fetch(`${baseUrl}/api/projects/p/review-candidates`);
    expect(missing.status).toBe(400);

    const zero = await fetch(`${baseUrl}/api/projects/p/review-candidates?limit=0`);
    expect(zero.status).toBe(400);
  });
});
