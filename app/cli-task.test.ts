import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { runIssueCli } from "./cli-program.js";
import {
  dir,
  env,
  nextAt,
  useCliTestFixtures,
  writeIssue,
} from "./cli.test-helpers.js";

useCliTestFixtures();

describe("task get/set", () => {
  const AT = "2026-07-10T14:00:00.000Z";
  const sha1 = "0123456789abcdef0123456789abcdef01234567";

  beforeEach(() => {
    writeIssue("p", { kind: "project", title: "Proj", createdAt: nextAt(), updatedAt: nextAt() });
    writeIssue("e", {
      kind: "epic",
      title: "Epic",
      partOf: "p",
      order: 0,
      blockedBy: [],
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeIssue("a", {
      kind: "story",
      title: "Branch A",
      partOf: "e",
      branchName: "feat/a",
      merged: false,
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("c1", {
      kind: "task",
      title: "Commit 1",
      partOf: "a",
      status: "todo",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
  });

  it("appends commits, refuses duplicates, sets the series, and chips the head", async () => {
    const sha2 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const append = await runIssueCli(["task", "add-commit", "c1", sha1], { env: env() });
    expect(append.status).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "c1", "issue.json"), "utf8")).commits).toEqual([
      sha1,
    ]);

    const again = await runIssueCli(["task", "add-commit", "c1", sha1], { env: env() });
    expect(again.status).toBe(1);
    expect(again.stderr).toMatch(/already on this Task/);

    const set = await runIssueCli(
      ["task", "set", "c1", "commits", JSON.stringify([sha1, sha2])],
      { env: env() },
    );
    expect(set.status).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "c1", "issue.json"), "utf8")).commits).toEqual([
      sha1,
      sha2,
    ]);

    const malformed = await runIssueCli(
      ["task", "set", "c1", "commits", JSON.stringify(["not-a-sha"])],
      { env: env() },
    );
    expect(malformed.status).toBe(1);
    expect(malformed.stderr).toMatch(/invalid commit sha "not-a-sha"/);
    expect(JSON.parse(readFileSync(join(dir, "c1", "issue.json"), "utf8")).commits).toEqual([
      sha1,
      sha2,
    ]);

    const tree = await runIssueCli(["tree", "p"], { env: env() });
    expect(tree.status).toBe(0);
    expect(tree.stdout).toMatch(/^ {6}task c1\b.*\bsha=bbbbbbb\b/m);
    expect(tree.stdout).not.toMatch(/^ {6}task c1\b.*\bsha=0123456\b/m);
  });

  it("replaces the head commit with an amend of it and appends a child commit", async () => {
    const repo = mkdtempSync(join(tmpdir(), "issue-cli-amend-"));
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: repo,
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "t",
          GIT_AUTHOR_EMAIL: "t@t",
          GIT_COMMITTER_NAME: "t",
          GIT_COMMITTER_EMAIL: "t@t",
        },
      }).trim();
    try {
      git("init", "-q");
      git("commit", "-q", "--allow-empty", "-m", "base");
      git("commit", "-q", "--allow-empty", "-m", "first");
      const first = git("rev-parse", "HEAD");
      git("commit", "-q", "--allow-empty", "--amend", "-m", "first amended");
      const amended = git("rev-parse", "HEAD");
      git("commit", "-q", "--allow-empty", "-m", "second");
      const second = git("rev-parse", "HEAD");
      writeIssue("a", {
        kind: "story",
        title: "Branch A",
        partOf: "e",
        branchName: "feat/a",
        worktreePath: repo,
        merged: false,
        order: 0,
        createdAt: AT,
        updatedAt: AT,
      });
      const commitsOf = () =>
        JSON.parse(readFileSync(join(dir, "c1", "issue.json"), "utf8")).commits;

      expect((await runIssueCli(["task", "add-commit", "c1", first], { env: env() })).status).toBe(0);
      expect((await runIssueCli(["task", "add-commit", "c1", amended], { env: env() })).status).toBe(0);
      expect(commitsOf()).toEqual([amended]);

      expect((await runIssueCli(["task", "add-commit", "c1", second], { env: env() })).status).toBe(0);
      expect(commitsOf()).toEqual([amended, second]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
