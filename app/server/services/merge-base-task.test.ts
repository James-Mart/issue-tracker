import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { runIssueCli } from "../../cli-program.js";
import {
  dir,
  env,
  nextAt,
  useCliTestFixtures,
  writeIssue,
} from "../../cli.test-helpers.js";

const GIT = [
  "-c",
  "user.name=test",
  "-c",
  "user.email=test@example.com",
  "-c",
  "commit.gpgsign=false",
];

function git(repo: string, args: string[]): void {
  execFileSync("git", [...GIT, ...args], {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function initRepo(): string {
  const repo = mkdtempSync(join(dir, "repo-"));
  git(repo, ["init", "-b", "main"]);
  writeFileSync(join(repo, "README"), "seed\n");
  git(repo, ["add", "README"]);
  git(repo, ["commit", "-m", "initial"]);
  return repo;
}

function commitFile(repo: string, name: string, message: string): void {
  writeFileSync(join(repo, name), `${message}\n`);
  git(repo, ["add", name]);
  git(repo, ["commit", "-m", message]);
}

function seedStory(worktreePath: string, branchName: string): void {
  writeIssue("p", {
    kind: "project",
    title: "P",
    createdAt: nextAt(),
    updatedAt: nextAt(),
  });
  writeIssue("s", {
    kind: "story",
    title: "Story",
    partOf: "p",
    merged: false,
    branchName,
    worktreePath,
    createdAt: nextAt(),
    updatedAt: nextAt(),
  });
}

async function getBehind(): Promise<{ stdout: string; stderr: string; status: number }> {
  return runIssueCli(["story", "get", "s", "behindMergeBase"], { env: env() });
}

describe("behindMergeBase", () => {
  useCliTestFixtures();

  it("is true when the histories have diverged", async () => {
    const repo = initRepo();
    git(repo, ["branch", "feat/story"]);
    commitFile(repo, "on-main", "main moved");
    git(repo, ["checkout", "feat/story"]);
    commitFile(repo, "on-story", "story moved");
    seedStory(repo, "feat/story");

    const result = await getBehind();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("true\n");
  });

  it("is false when the branch contains origin/main but not local main", async () => {
    const repo = initRepo();
    const bare = mkdtempSync(join(dir, "bare-"));
    git(bare, ["init", "--bare", "-b", "main"]);
    git(repo, ["remote", "add", "origin", bare]);
    git(repo, ["push", "origin", "main"]);
    git(repo, ["checkout", "-b", "feat/story"]);
    commitFile(repo, "story-work", "story commit");
    git(repo, ["checkout", "main"]);
    commitFile(repo, "local-main", "local main moved");
    seedStory(repo, "feat/story");

    const result = await getBehind();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("false\n");

    rmSync(bare, { recursive: true, force: true });
  });
});
