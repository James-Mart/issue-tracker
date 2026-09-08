import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { runIssueCli } from "./cli-program.js";
import {
  dir,
  env,
  issueJsonField,
  nextAt,
  useCliTestFixtures,
  writeIssue,
} from "./cli.test-helpers.js";

useCliTestFixtures();

describe("kind-scoped add", () => {
  beforeEach(() => {
    writeIssue("p", { kind: "project", title: "Proj", createdAt: nextAt(), updatedAt: nextAt() });
    writeIssue("e", {
      kind: "epic",
      title: "Epic",
      partOf: "p",
      blockedBy: [],
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeIssue("a", {
      kind: "story",
      title: "Story A",
      partOf: "e",
      merged: false,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
  });

  it.each([
    {
      kind: "task",
      args: ["task", "add", "--part-of", "a", "Child Task", "--assignee", "carol"],
      id: "child-task",
      partOf: "a",
      assignee: "carol",
    },
  ])("adds $kind under the correct parent with assignee", async ({ args, id, partOf, assignee }) => {
    const result = await runIssueCli(args, { env: env() });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(id);
    expect(issueJsonField(id, "partOf")).toBe(partOf);
    expect(issueJsonField(id, "assignee")).toBe(assignee);
  });

  it.each([
    {
      kind: "task",
      args: ["task", "add", "--part-of", "e", "Nope"],
      error: /must be a story/,
    },
  ])("rejects a bad parent for $kind", async ({ args, error }) => {
    const result = await runIssueCli(args, { env: env() });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(error);
  });
});

describe("task get/set", () => {
  const AT = "2026-07-10T14:00:00.000Z";
  const sha1 = "0123456789abcdef0123456789abcdef01234567";
  const sha256 =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

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
    writeIssue("a2", {
      kind: "story",
      title: "Branch A2",
      partOf: "e",
      merged: false,
      order: 1,
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
    writeIssue("c2", {
      kind: "task",
      title: "Commit 2",
      partOf: "a",
      status: "todo",
      order: 1,
      createdAt: AT,
      updatedAt: AT,
    });
    writeFileSync(join(dir, "c1", "description.md"), "# Commit\n\nbody\n");
  });

  it("gets and sets allowlisted commit fields", async () => {
    expect((await runIssueCli(["task", "get", "c1", "title"], { env: env() })).stdout).toBe("Commit 1\n");
    expect((await runIssueCli(["task", "get", "c1", "description"], { env: env() })).stdout).toBe("# Commit\n\nbody\n");
    expect((await runIssueCli(["task", "get", "c1", "status"], { env: env() })).stdout).toBe("todo\n");
    expect((await runIssueCli(["task", "get", "c1", "noDiff"], { env: env() })).stdout).toBe("");

    expect((await runIssueCli(["task", "set", "c1", "title", "Renamed"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["task", "get", "c1", "title"], { env: env() })).stdout).toBe("Renamed\n");

    expect((await runIssueCli(["task", "set", "c1", "status", "in-progress"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["task", "get", "c1", "status"], { env: env() })).stdout).toBe("in-progress\n");

    expect((await runIssueCli(["task", "set", "c1", "status", "fixing"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["task", "get", "c1", "status"], { env: env() })).stdout).toBe("fixing\n");

    expect((await runIssueCli(["task", "set", "c1", "qa", "reviewing"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["task", "get", "c1", "qa"], { env: env() })).stdout).toBe("reviewing\n");
    expect((await runIssueCli(["task", "set", "c1", "qa", "--clear"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["task", "get", "c1", "qa"], { env: env() })).stdout).toBe("");

    const invalidQa = await runIssueCli(["task", "set", "c1", "qa", "pending"], { env: env() });
    expect(invalidQa.status).toBe(1);
    expect(invalidQa.stderr).toMatch(/invalid qa "pending"/);

    expect(
      (await runIssueCli(["task", "set", "c1", "commits", JSON.stringify([sha1])], { env: env() })).status,
    ).toBe(0);
    expect((await runIssueCli(["task", "get", "c1", "commits"], { env: env() })).stdout).toBe(
      `${JSON.stringify([sha1])}\n`,
    );
    expect(
      (await runIssueCli(["task", "set", "c1", "commits", "[]"], { env: env() })).status,
    ).toBe(0);
    expect((await runIssueCli(["task", "get", "c1", "commits"], { env: env() })).stdout).toBe("[]\n");

    expect((await runIssueCli(["task", "set", "c1", "noDiff", "true"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["task", "get", "c1", "noDiff"], { env: env() })).stdout).toBe("true\n");
    expect((await runIssueCli(["task", "set", "c1", "noDiff", "false"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["task", "get", "c1", "noDiff"], { env: env() })).stdout).toBe("");

    expect((await runIssueCli(["task", "set", "c1", "assignee", "bot"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["task", "get", "c1", "assignee"], { env: env() })).stdout).toBe("bot\n");
    expect((await runIssueCli(["task", "set", "c1", "assignee", "--clear"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["task", "get", "c1", "assignee"], { env: env() })).stdout).toBe("");

    expect(
      (await runIssueCli(["task", "set", "c1", "needsAttention", "true", "--reason", "blocked"], { env: env() })).status,
    ).toBe(0);
    expect((await runIssueCli(["task", "get", "c1", "needsAttention"], { env: env() })).stdout).toBe("true\n");
    expect((await runIssueCli(["task", "get", "c1", "attentionReason"], { env: env() })).stdout).toBe("blocked\n");
    expect((await runIssueCli(["task", "set", "c1", "needsAttention", "false"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["task", "get", "c1", "needsAttention"], { env: env() })).stdout).toBe("false\n");
    expect((await runIssueCli(["task", "get", "c1", "attentionReason"], { env: env() })).stdout).toBe("");
  });

  it("sets description from --file", async () => {
    const descFile = join(dir, "desc.md");
    writeFileSync(descFile, "from file\n");
    expect(
      (await runIssueCli(["task", "set", "c1", "description", "--file", descFile], { env: env() })).status,
    ).toBe(0);
    expect((await runIssueCli(["task", "get", "c1", "description"], { env: env() })).stdout).toBe("from file\n");
  });

  it("gets derived blocked", async () => {
    expect((await runIssueCli(["task", "get", "c1", "blocked"], { env: env() })).stdout).toBe("false\n");
    expect((await runIssueCli(["task", "get", "c2", "blocked"], { env: env() })).stdout).toBe("true\n");

    expect((await runIssueCli(["task", "set", "c1", "status", "done"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["task", "get", "c1", "blocked"], { env: env() })).stdout).toBe("false\n");
    expect((await runIssueCli(["task", "get", "c2", "blocked"], { env: env() })).stdout).toBe("false\n");
  });

  it("refuses kind mismatch, unknown fields, and invalid commits / noDiff", async () => {
    const mismatch = await runIssueCli(["task", "get", "a", "title"], { env: env() });
    expect(mismatch.status).toBe(1);
    expect(mismatch.stderr).toContain('"a" is a story, not a task');

    const unknownGet = await runIssueCli(["task", "get", "c1", "branchName"], { env: env() });
    expect(unknownGet.status).toBe(1);
    expect(unknownGet.stderr).toContain('unknown field "branchName" for task');

    const removedReady = await runIssueCli(["task", "get", "c1", "ready"], { env: env() });
    expect(removedReady.status).toBe(1);
    expect(removedReady.stderr).toContain('unknown field "ready" for task');

    const unknownSet = await runIssueCli(["task", "set", "c1", "branchName", "feat/x"], { env: env() });
    expect(unknownSet.status).toBe(1);
    expect(unknownSet.stderr).toContain(
      'unknown or unsettable field "branchName" for task',
    );

    const badSha = await runIssueCli(
      ["task", "set", "c1", "commits", JSON.stringify(["4019c25"])],
      { env: env() },
    );
    expect(badSha.status).toBe(1);
    expect(badSha.stderr).toMatch(/invalid commit sha "4019c25"/);

    const shortSha = await runIssueCli([
      "task",
      "set",
      "c1",
      "commits",
      JSON.stringify(["0123456789abcdef0123456789abcdef0123456"]),
    ], { env: env() });
    expect(shortSha.status).toBe(1);
    expect(shortSha.stderr).toMatch(/invalid commit sha/);

    const nonHex = await runIssueCli([
      "task",
      "set",
      "c1",
      "commits",
      JSON.stringify(["ghijghijghijghijghijghijghijghijghijghij"]),
    ], { env: env() });
    expect(nonHex.status).toBe(1);
    expect(nonHex.stderr).toMatch(/invalid commit sha/);

    const upper = await runIssueCli([
      "task",
      "set",
      "c1",
      "commits",
      JSON.stringify(["0123456789ABCDEF0123456789ABCDEF01234567"]),
    ], { env: env() });
    expect(upper.status).toBe(1);
    expect(upper.stderr).toMatch(/invalid commit sha/);

    expect(
      (await runIssueCli(["task", "set", "a", "commits", JSON.stringify([sha1])], { env: env() })).stderr,
    ).toMatch(/"a" is a story, not a task/);
    expect((await runIssueCli(["task", "set", "a", "noDiff", "true"], { env: env() })).stderr).toMatch(
      /"a" is a story, not a task/,
    );

    const badNoDiff = await runIssueCli(["task", "set", "c1", "noDiff", "maybe"], { env: env() });
    expect(badNoDiff.status).toBe(1);
    expect(badNoDiff.stderr).toMatch(/invalid noDiff "maybe"/);
  });

  it("surfaces qa in view/tree and preserves it across apply", async () => {
    expect((await runIssueCli(["task", "view", "c1"], { env: env() })).stdout).not.toContain("qa:");

    expect((await runIssueCli(["task", "set", "c1", "status", "fixing"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["task", "set", "c1", "qa", "passed"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["task", "view", "c1"], { env: env() })).stdout).toContain("status: fixing");
    expect((await runIssueCli(["task", "view", "c1"], { env: env() })).stdout).toContain("qa: passed");
    expect((await runIssueCli(["tree", "p"], { env: env() })).stdout).toMatch(/^ {6}task c1\b.*\bqa=passed/m);

    const applyPath = join(dir, "task-apply.yaml");
    writeFileSync(
      applyPath,
      `project: p
epic:
  id: e
  title: Epic
  children:
    - kind: story
      id: a
      title: Branch A
      children:
        - kind: task
          id: c1
          title: Commit 1 renamed
`,
    );
    expect((await runIssueCli(["apply", applyPath], { env: env() })).status).toBe(0);
    const onDisk = JSON.parse(readFileSync(join(dir, "c1", "issue.json"), "utf8"));
    expect(onDisk.status).toBe("fixing");
    expect(onDisk.qa).toBe("passed");
    expect((await runIssueCli(["task", "view", "c1"], { env: env() })).stdout).toContain("qa: passed");
    expect((await runIssueCli(["task", "view", "c1"], { env: env() })).stdout).toContain("title: Commit 1 renamed");

    expect((await runIssueCli(["task", "set", "c1", "qa", "--clear"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["tree", "p"], { env: env() })).stdout).not.toMatch(/^ {6}task c1\b.*\bqa=/m);
  });

  it("accepts sha256 commits and surfaces noDiff in view/summary", async () => {
    expect(
      (await runIssueCli(["task", "set", "c1", "commits", JSON.stringify([sha256])], { env: env() }))
        .status,
    ).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "c1", "issue.json"), "utf8")).commits).toEqual(
      [sha256],
    );

    expect((await runIssueCli(["task", "view", "c1"], { env: env() })).stdout).not.toContain("noDiff:");
    expect((await runIssueCli(["task", "set", "c1", "noDiff", "true"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["task", "view", "c1"], { env: env() })).stdout).toContain("noDiff: true");
    expect((await runIssueCli(["summary", "c1"], { env: env() })).stdout).toContain("noDiff: true");

    expect((await runIssueCli(["task", "set", "c1", "noDiff", "false"], { env: env() })).status).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "c1", "issue.json"), "utf8"))).not.toHaveProperty(
      "noDiff",
    );
    expect((await runIssueCli(["task", "view", "c1"], { env: env() })).stdout).not.toContain("noDiff:");
  });

  it("gets whitespace assignee as stored and errors on unknown id", async () => {
    writeIssue("c1", {
      kind: "task",
      title: "Commit 1",
      partOf: "a",
      status: "todo",
      assignee: "   ",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    expect((await runIssueCli(["task", "get", "c1", "assignee"], { env: env() })).stdout).toBe("   \n");

    const unknown = await runIssueCli(["task", "get", "ghost", "assignee"], { env: env() });
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain('unknown issue "ghost"');
  });

  it("reparents via partOf and rejects bad parents", async () => {
    expect((await runIssueCli(["task", "set", "c1", "partOf", "a2"], { env: env() })).status).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "c1", "issue.json"), "utf8")).partOf).toBe("a2");

    const wrongKind = await runIssueCli(["task", "set", "c1", "partOf", "e"], { env: env() });
    expect(wrongKind.status).toBe(1);
    expect(wrongKind.stderr).toMatch(/must be a story, not a epic/);
    expect(JSON.parse(readFileSync(join(dir, "c1", "issue.json"), "utf8")).partOf).toBe("a2");

    const unknown = await runIssueCli(["task", "set", "c1", "partOf", "ghost"], { env: env() });
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toMatch(/references unknown issue "ghost"/);
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
});
