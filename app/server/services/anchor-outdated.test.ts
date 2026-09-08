import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Comment } from "../schemas.js";

const AT = "2026-07-09T14:00:00.000Z";
const GIT = [
  "-c",
  "user.name=test",
  "-c",
  "user.email=test@example.com",
  "-c",
  "commit.gpgsign=false",
];

let issuesDir: string;
let workspace: string;
let shaInitial: string;
let shaChangedLine: string;
let shaChangedRange: string;
let shaDeleted: string;

function git(repo: string, args: string[]): string {
  return execFileSync("git", [...GIT, ...args], {
    cwd: repo,
    encoding: "utf8",
  }).trim();
}

function writeRepoFile(repo: string, rel: string, contents: string): void {
  const dest = join(repo, rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, contents);
}

function commit(repo: string, message: string): string {
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", message]);
  return git(repo, ["rev-parse", "HEAD"]);
}

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(issuesDir, id), { recursive: true });
  writeFileSync(join(issuesDir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function comment(
  overrides: Partial<Comment> & Pick<Comment, "id">,
): Comment {
  return {
    role: "agent",
    body: overrides.body ?? overrides.id,
    at: AT,
    ...overrides,
  };
}

function anchored(
  id: string,
  anchor: NonNullable<Comment["anchor"]>,
): Comment {
  return comment({ id, anchor });
}

beforeEach(() => {
  issuesDir = mkdtempSync(join(tmpdir(), "issue-tracker-anchor-outdated-"));
  workspace = mkdtempSync(join(tmpdir(), "issue-tracker-anchor-outdated-ws-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesDir);

  git(workspace, ["init", "-b", "main"]);
  writeRepoFile(
    workspace,
    "src/lines.ts",
    "const a = 1;\nconst b = 2;\nconst c = 3;\n",
  );
  writeRepoFile(workspace, "src/range.ts", "one\ntwo\nthree\nfour\n");
  writeRepoFile(workspace, "src/doomed.ts", "gone soon\n");
  shaInitial = commit(workspace, "initial");

  writeRepoFile(
    workspace,
    "src/lines.ts",
    "const a = 1;\nconst b = 20;\nconst c = 3;\n",
  );
  shaChangedLine = commit(workspace, "change line two");

  writeRepoFile(workspace, "src/range.ts", "one\nTWO\nthree\nfour\n");
  shaChangedRange = commit(workspace, "change one range line");

  git(workspace, ["rm", "src/doomed.ts"]);
  shaDeleted = commit(workspace, "delete doomed");

  writeIssue("p", {
    kind: "project",
    title: "P",
    workspace,
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
  writeIssue("t-series", {
    kind: "task",
    title: "series",
    partOf: "s",
    status: "done",
    order: 0,
    commits: [shaInitial, shaChangedLine, shaChangedRange, shaDeleted],
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("t-empty", {
    kind: "task",
    title: "empty",
    partOf: "s",
    status: "todo",
    order: 1,
    createdAt: AT,
    updatedAt: AT,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(issuesDir, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

async function load() {
  return import("./anchor-outdated.js");
}

describe("deriveAnchoredOutdated", () => {
  it("leaves an untouched anchored line current", async () => {
    const { deriveAnchoredOutdated } = await load();
    const [result] = await deriveAnchoredOutdated("t-series", [
      anchored("untouched", {
        path: "src/lines.ts",
        side: "new",
        line: 1,
        commitSha: shaInitial,
      }),
    ]);
    expect(result?.outdated).toBe(false);
  });

  it("marks a line whose content changed in a later commit", async () => {
    const { deriveAnchoredOutdated } = await load();
    const [result] = await deriveAnchoredOutdated("t-series", [
      anchored("changed", {
        path: "src/lines.ts",
        side: "new",
        line: 2,
        commitSha: shaInitial,
      }),
    ]);
    expect(result?.outdated).toBe(true);
  });

  it("marks a range outdated when only one of its lines changed", async () => {
    const { deriveAnchoredOutdated } = await load();
    const [result] = await deriveAnchoredOutdated("t-series", [
      anchored("range", {
        path: "src/range.ts",
        side: "new",
        startLine: 1,
        line: 3,
        commitSha: shaInitial,
      }),
    ]);
    expect(result?.outdated).toBe(true);
  });

  it("marks an anchor outdated when the file was deleted after it", async () => {
    const { deriveAnchoredOutdated } = await load();
    const [result] = await deriveAnchoredOutdated("t-series", [
      anchored("deleted", {
        path: "src/doomed.ts",
        side: "new",
        line: 1,
        commitSha: shaInitial,
      }),
    ]);
    expect(result?.outdated).toBe(true);
  });

  it("marks an anchored comment outdated when the issue has no commits", async () => {
    const { deriveAnchoredOutdated } = await load();
    const [result] = await deriveAnchoredOutdated("t-empty", [
      anchored("no-commits", {
        path: "src/lines.ts",
        side: "new",
        line: 1,
        commitSha: shaInitial,
      }),
    ]);
    expect(result?.outdated).toBe(true);
  });

  it("derives outdated for a Story-anchored comment from the rolled-up head", async () => {
    const { deriveAnchoredOutdated } = await load();
    const results = await deriveAnchoredOutdated("s", [
      comment({ id: "plain", body: "unanchored" }),
      anchored("story-changed", {
        path: "src/lines.ts",
        side: "new",
        line: 2,
        commitSha: shaInitial,
      }),
    ]);
    expect(results[0]).not.toHaveProperty("outdated");
    expect(results[1]?.outdated).toBe(true);
  });
});
