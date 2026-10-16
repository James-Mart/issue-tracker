import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { git, initRepo } from "./cli-story-worktree.test-fixtures.js";
import { runIssueCli } from "./cli-program.js";
import { env, nextAt, useCliTestFixtures, writeIssue } from "./cli.test-helpers.js";

useCliTestFixtures();

const repos: string[] = [];

afterEach(() => {
  for (const repo of repos) rmSync(repo, { recursive: true, force: true });
  repos.length = 0;
});

function repoWithTip(): { repo: string; base: string; tip: string } {
  const repo = initRepo();
  repos.push(repo);
  const base = git(repo, ["rev-parse", "HEAD"]);
  git(repo, ["checkout", "-b", "story"]);
  writeFileSync(join(repo, "a.txt"), "tip\n");
  git(repo, ["add", "a.txt"]);
  git(repo, ["commit", "-m", "tip"]);
  const tip = git(repo, ["rev-parse", "HEAD"]);
  git(repo, ["checkout", "main"]);
  return { repo, base, tip };
}

const PR_URL = "https://github.com/example/repo/pull/7";

describe("review view", () => {
  it("prints pull-request fields and a local diff range without fetching", async () => {
    const { repo, base, tip } = repoWithTip();
    git(repo, ["remote", "add", "origin", "/not/a/remote"]);
    git(repo, ["update-ref", "refs/remotes/origin/main", base]);
    writeIssue("p", {
      kind: "project",
      title: "P",
      workspace: repo,
      order: 0,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeIssue("r", {
      kind: "review",
      title: "Review",
      partOf: "p",
      archived: false,
      marks: { all: {}, commits: {} },
      submissions: [],
      order: 0,
      createdAt: nextAt(),
      updatedAt: nextAt(),
      pr: {
        url: PR_URL,
        number: 7,
        baseRef: "main",
        headRef: "feature",
        headSha: tip,
        fork: false,
      },
    });

    const bare = await runIssueCli(["view", "r"], { env: env() });
    const named = await runIssueCli(["review", "view", "r"], { env: env() });
    expect(named).toEqual(bare);
    expect(bare.status).toBe(0);
    const header = bare.stdout.split("\n\n")[0] ?? "";
    expect(header).not.toMatch(/^story: /m);
    expect(header).toContain("status: open");
    expect(header).toContain("prFork: false");
    expect(header).toContain(`diffRange: origin/main...${tip}`);
  });
});
