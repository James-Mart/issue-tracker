import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { runIssueCli } from "./cli-program.js";
import {
  dir,
  env,
  issueJsonField,
  mergeBaseOf,
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
      kind: "story",
      args: ["story", "add", "--part-of", "e", "Child Story", "--assignee", "bob"],
    },
  ])("rejects $kind add with --assignee", async ({ args }) => {
    const result = await runIssueCli(args, { env: env() });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/unknown option '--assignee'/);
  });

  it("stacks a story with --stacked-on", async () => {
    const help = await runIssueCli(["story", "add", "--help"], { env: env() });
    expect(help.status).toBe(0);
    expect(help.stdout).toMatch(/--stacked-on <story>/);
    expect(help.stdout).not.toMatch(/<branch>/);

    const taskHelp = await runIssueCli(["task", "add", "--help"], { env: env() });
    expect(taskHelp.status).toBe(0);
    expect(taskHelp.stdout).toMatch(/--part-of <story>/);
    expect(taskHelp.stdout).not.toMatch(/<branch>/);

    const add = await runIssueCli([
      "story",
      "add",
      "Stacked Child",
      "--part-of",
      "e",
      "--stacked-on",
      "a",
    ], { env: env() });
    expect(add.status).toBe(0);
    expect(add.stdout.trim()).toBe("stacked-child");
    expect(issueJsonField("stacked-child", "stackedOn")).toBe("a");
  });

  it.each([
    {
      kind: "story",
      args: ["story", "add", "--part-of", "a", "Nope"],
      error: /must be one of: project, epic/,
    },
  ])("rejects a bad parent for $kind", async ({ args, error }) => {
    const result = await runIssueCli(args, { env: env() });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(error);
  });

  it("adds a story under a project and reparents between project and epic", async () => {
    const add = await runIssueCli([
      "story",
      "add",
      "Solo Story",
      "--part-of",
      "p",
    ], { env: env() });
    expect(add.status).toBe(0);
    expect(add.stdout.trim()).toBe("solo-story");
    expect(issueJsonField("solo-story", "partOf")).toBe("p");

    expect((await runIssueCli(["story", "set", "solo-story", "partOf", "e"], { env: env() })).status).toBe(
      0,
    );
    expect(issueJsonField("solo-story", "partOf")).toBe("e");

    expect((await runIssueCli(["story", "set", "solo-story", "partOf", "p"], { env: env() })).status).toBe(
      0,
    );
    expect(issueJsonField("solo-story", "partOf")).toBe("p");

    const bad = await runIssueCli(["story", "set", "solo-story", "partOf", "a"], { env: env() });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/must be one of: project, epic/);
  });
});

describe("story get/set", () => {
  const AT = "2026-07-10T14:00:00.000Z";

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
      merged: false,
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("b", {
      kind: "story",
      title: "Branch B",
      partOf: "e",
      stackedOn: "a",
      merged: false,
      order: 1,
      createdAt: AT,
      updatedAt: AT,
    });
    writeFileSync(join(dir, "a", "description.md"), "# Branch\n\nbody\n");
  });

  it("gets and sets allowlisted branch fields", async () => {
    expect((await runIssueCli(["story", "get", "a", "title"], { env: env() })).stdout).toBe("Branch A\n");
    expect((await runIssueCli(["story", "get", "a", "description"], { env: env() })).stdout).toBe("# Branch\n\nbody\n");
    expect((await runIssueCli(["story", "get", "a", "merged"], { env: env() })).stdout).toBe("false\n");
    expect((await runIssueCli(["story", "get", "b", "stackedOn"], { env: env() })).stdout).toBe("a\n");

    expect((await runIssueCli(["story", "set", "a", "title", "Renamed"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["story", "get", "a", "title"], { env: env() })).stdout).toBe("Renamed\n");

    expect((await runIssueCli(["story", "set", "a", "branchName", "feat/a"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["story", "get", "a", "branchName"], { env: env() })).stdout).toBe("feat/a\n");

    expect((await runIssueCli(["story", "set", "b", "stackedOn", "--clear"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["story", "get", "b", "stackedOn"], { env: env() })).stdout).toBe("");
    expect((await runIssueCli(["story", "set", "b", "stackedOn", "a"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["story", "get", "b", "stackedOn"], { env: env() })).stdout).toBe("a\n");

    expect((await runIssueCli(["story", "set", "a", "prUrl", "https://pr/1"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["story", "get", "a", "prUrl"], { env: env() })).stdout).toBe("https://pr/1\n");
    expect((await runIssueCli(["story", "set", "a", "prUrl", "--clear"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["story", "get", "a", "prUrl"], { env: env() })).stdout).toBe("");

    expect((await runIssueCli(["story", "set", "a", "review", "passed"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["story", "get", "a", "review"], { env: env() })).stdout).toBe("passed\n");

    expect((await runIssueCli(["story", "set", "a", "needsRebase", "main"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["story", "get", "a", "needsRebase"], { env: env() })).stdout).toBe("main\n");
    expect((await runIssueCli(["story", "set", "a", "needsRebase", "--clear"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["story", "get", "a", "needsRebase"], { env: env() })).stdout).toBe("");

    expect((await runIssueCli(["story", "set", "a", "retro", "in-progress"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["story", "get", "a", "retro"], { env: env() })).stdout).toBe("in-progress\n");
    expect((await runIssueCli(["story", "set", "a", "retro", "done"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["story", "get", "a", "retro"], { env: env() })).stdout).toBe("done\n");
    expect((await runIssueCli(["story", "set", "a", "retro", "--clear"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["story", "get", "a", "retro"], { env: env() })).stdout).toBe("");

    const invalidRetro = await runIssueCli(["story", "set", "a", "retro", "pending"], { env: env() });
    expect(invalidRetro.status).toBe(1);
    expect(invalidRetro.stderr).toMatch(/invalid retro "pending"/);

    const unknownAssigneeGet = await runIssueCli(["story", "get", "a", "assignee"], { env: env() });
    expect(unknownAssigneeGet.status).toBe(1);
    expect(unknownAssigneeGet.stderr).toContain('unknown field "assignee" for story');
    const unknownAssigneeSet = await runIssueCli(["story", "set", "a", "assignee", "bot"], { env: env() });
    expect(unknownAssigneeSet.status).toBe(1);
    expect(unknownAssigneeSet.stderr).toContain(
      'unknown or unsettable field "assignee" for story',
    );

    expect(
      (await runIssueCli(["story", "set", "a", "needsAttention", "true", "--reason", "blocked"], { env: env() })).status,
    ).toBe(0);
    expect((await runIssueCli(["story", "get", "a", "needsAttention"], { env: env() })).stdout).toBe("true\n");
    expect((await runIssueCli(["story", "get", "a", "attentionReason"], { env: env() })).stdout).toBe("blocked\n");
    expect((await runIssueCli(["story", "set", "a", "needsAttention", "false"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["story", "get", "a", "needsAttention"], { env: env() })).stdout).toBe("false\n");
    expect((await runIssueCli(["story", "get", "a", "attentionReason"], { env: env() })).stdout).toBe("");
  });

  it("gets derived storyStatus, mergeBase, and blocked", async () => {
    expect((await runIssueCli(["story", "get", "a", "storyStatus"], { env: env() })).stdout).toBe("not-started\n");
    expect((await runIssueCli(["story", "get", "a", "mergeBase"], { env: env() })).stdout).toBe("main\n");
    expect((await runIssueCli(["story", "get", "a", "blocked"], { env: env() })).stdout).toBe("false\n");

    expect((await runIssueCli(["story", "get", "b", "blocked"], { env: env() })).stdout).toBe("true\n");
    // b is stacked on unnamed a — derived mergeBase unset.
    expect((await runIssueCli(["story", "get", "b", "mergeBase"], { env: env() })).stdout).toBe("");

    const add = await runIssueCli([
      "story",
      "add",
      "Unset child",
      "--part-of",
      "e",
      "--stacked-on",
      "a",
    ], { env: env() });
    expect(add.status).toBe(0);
    const childId = add.stdout.trim();
    expect((await runIssueCli(["story", "get", childId, "mergeBase"], { env: env() })).stdout).toBe("");

    expect((await runIssueCli(["story", "set", "a", "branchName", "feat/a"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["story", "get", "a", "storyStatus"], { env: env() })).stdout).toBe("in-progress\n");
    expect((await runIssueCli(["story", "get", "b", "blocked"], { env: env() })).stdout).toBe("false\n");
    expect((await runIssueCli(["story", "get", "b", "mergeBase"], { env: env() })).stdout).toBe("feat/a\n");
    expect(mergeBaseOf("b")).toBeUndefined();

    writeIssue("c1", {
      kind: "task",
      title: "C1",
      partOf: "a",
      status: "done",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    expect((await runIssueCli(["story", "set", "a", "prUrl", "https://pr/1"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["story", "get", "a", "storyStatus"], { env: env() })).stdout).toBe("pr-open\n");
  });

  it("does not cascade mergeBase on disk when parent is merged", async () => {
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
    writeIssue("b", {
      kind: "story",
      title: "Branch B",
      partOf: "e",
      stackedOn: "a",
      merged: false,
      order: 1,
      createdAt: AT,
      updatedAt: AT,
    });

    expect((await runIssueCli(["story", "set", "a", "merged", "true"], { env: env() })).status).toBe(0);
    expect(mergeBaseOf("b")).toBeUndefined();
    expect((await runIssueCli(["story", "get", "b", "mergeBase"], { env: env() })).stdout).toBe("main\n");
    expect((await runIssueCli(["story", "get", "a", "merged"], { env: env() })).stdout).toBe("true\n");
  });

  it("refuses kind mismatch and unknown fields; mergeBase sets override", async () => {
    const mismatch = await runIssueCli(["story", "get", "e", "title"], { env: env() });
    expect(mismatch.status).toBe(1);
    expect(mismatch.stderr).toContain('"e" is an epic, not a story');

    const unknownGet = await runIssueCli(["story", "get", "a", "blockedBy"], { env: env() });
    expect(unknownGet.status).toBe(1);
    expect(unknownGet.stderr).toContain('unknown field "blockedBy" for story');

    const removedBase = await runIssueCli(["story", "get", "a", "base"], { env: env() });
    expect(removedBase.status).toBe(1);
    expect(removedBase.stderr).toContain('unknown field "base" for story');

    const removedReady = await runIssueCli(["story", "get", "a", "ready"], { env: env() });
    expect(removedReady.status).toBe(1);
    expect(removedReady.stderr).toContain('unknown field "ready" for story');

    const epicStorySet = await runIssueCli(["story", "set", "a", "mergeBase", "feat/existing"], { env: env() });
    expect(epicStorySet.status).toBe(1);
    expect(epicStorySet.stderr).toContain(
      "mergeBase can only be set on a root-level Story or an Epic",
    );

    const stackedSet = await runIssueCli(["story", "set", "b", "mergeBase", "feat/stacked"], { env: env() });
    expect(stackedSet.status).toBe(1);
    expect(stackedSet.stderr).toContain(
      "mergeBase can only be set on a root-level Story or an Epic",
    );

    writeIssue("root", {
      kind: "story",
      title: "Root story",
      partOf: "p",
      merged: false,
      order: 2,
      createdAt: AT,
      updatedAt: AT,
    });
    expect((await runIssueCli(["story", "set", "root", "mergeBase", "feat/existing"], { env: env() })).status).toBe(
      0,
    );
    expect(issueJsonField("root", "mergeBaseOverride")).toBe("feat/existing");
    expect(issueJsonField("root", "mergeBase")).toBeUndefined();
    expect((await runIssueCli(["story", "get", "root", "mergeBase"], { env: env() })).stdout).toBe(
      "feat/existing\n",
    );

    expect((await runIssueCli(["epic", "set", "e", "mergeBase", "feat/epic-base"], { env: env() })).status).toBe(
      0,
    );
    expect(issueJsonField("e", "mergeBaseOverride")).toBe("feat/epic-base");
    expect((await runIssueCli(["story", "get", "a", "mergeBase"], { env: env() })).stdout).toBe(
      "feat/epic-base\n",
    );

    writeIssue("c1", {
      kind: "task",
      title: "C1",
      partOf: "a",
      status: "todo",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    const setOnCommit = await runIssueCli(["story", "set", "c1", "review", "passed"], { env: env() });
    expect(setOnCommit.status).toBe(1);
    expect(setOnCommit.stderr).toMatch(/"c1" is a task, not a story/);
  });

  it("surfaces review in view/list and preserves it across apply", async () => {
    expect((await runIssueCli(["story", "view", "a"], { env: env() })).stdout).not.toContain("review:");

    expect((await runIssueCli(["story", "set", "a", "review", "passed"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["story", "view", "a"], { env: env() })).stdout).toContain("review: passed");

    const listed = JSON.parse((await runIssueCli(["list", "--in", "p"], { env: env() })).stdout);
    const branch = listed.issues.find((i: { id: string }) => i.id === "a");
    expect(branch.review).toBe("passed");

    const invalid = await runIssueCli(["story", "set", "a", "review", "pending"], { env: env() });
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toMatch(/invalid review "pending"/);

    const applyPath = join(dir, "epic.yaml");
    writeFileSync(
      applyPath,
      `project: p
epic:
  id: e
  title: Epic
  children:
    - kind: story
      id: a
      title: Branch A renamed
`,
    );
    expect((await runIssueCli(["story", "set", "a", "review", "failed"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["apply", applyPath], { env: env() })).status).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "a", "issue.json"), "utf8")).review).toBe(
      "failed",
    );
    expect((await runIssueCli(["story", "view", "a"], { env: env() })).stdout).toContain("review: failed");
    expect((await runIssueCli(["story", "view", "a"], { env: env() })).stdout).toContain("title: Branch A renamed");
  });

  it("preserves retro across apply", async () => {
    expect((await runIssueCli(["story", "set", "a", "retro", "in-progress"], { env: env() })).status).toBe(0);

    const applyPath = join(dir, "epic-retro.yaml");
    writeFileSync(
      applyPath,
      `project: p
epic:
  id: e
  title: Epic
  children:
    - kind: story
      id: a
      title: Branch A renamed
`,
    );
    expect((await runIssueCli(["apply", applyPath], { env: env() })).status).toBe(0);
    const onDisk = JSON.parse(readFileSync(join(dir, "a", "issue.json"), "utf8"));
    expect(onDisk.retro).toBe("in-progress");
    expect(onDisk.title).toBe("Branch A renamed");
  });
});

describe("story append", () => {
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
    writeIssue("keep", {
      kind: "task",
      title: "Keep",
      partOf: "a",
      status: "todo",
      order: 0,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
  });

  it("appends tasks from a story-form doc without pruning", async () => {
    const path = join(dir, "append.yaml");
    writeFileSync(
      path,
      `project: p
epic: e
story:
  id: a
  title: Story A
  children:
    - kind: task
      id: added
      title: Added
`,
    );
    const result = await runIssueCli(["story", "append", "a", path], { env: env() });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/created: 1 \(added\)/);
    expect(JSON.parse(readFileSync(join(dir, "added", "issue.json"), "utf8")).appended).toBe(
      true,
    );
    expect(existsSync(join(dir, "keep"))).toBe(true);
    expect((await runIssueCli(["task", "get", "added", "appended"], { env: env() })).stdout).toBe(
      "true\n",
    );
    expect((await runIssueCli(["task", "get", "keep", "appended"], { env: env() })).stdout).toBe("");
  });
});

describe("story update-from-merge-base", () => {
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
      branchName: "feat/a",
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeIssue("keep", {
      kind: "task",
      title: "Keep",
      partOf: "a",
      status: "done",
      order: 0,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
  });

  it("appends one Task at the tail with both refs in its description", async () => {
    const result = await runIssueCli(["story", "update-from-merge-base", "a"], {
      env: env(),
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/created: 1 \(update-from-merge-base\)/);
    expect(result.stdout).toMatch(/updated: 0/);

    const task = JSON.parse(
      readFileSync(join(dir, "update-from-merge-base", "issue.json"), "utf8"),
    );
    expect(task.partOf).toBe("a");
    expect(task.order).toBe(1);
    expect(task.appended).toBe(true);
    expect(existsSync(join(dir, "keep"))).toBe(true);

    const description = readFileSync(
      join(dir, "update-from-merge-base", "description.md"),
      "utf8",
    );
    expect(description).toContain("feat/a");
    expect(description).toContain("main");
  });

  it("refuses a merged Story with the append-target reason", async () => {
    writeIssue("a", {
      kind: "story",
      title: "Story A",
      partOf: "e",
      merged: true,
      branchName: "feat/a",
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });

    const result = await runIssueCli(["story", "update-from-merge-base", "a"], {
      env: env(),
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/appendTo cannot target merged Story "a"/);
    expect(existsSync(join(dir, "update-from-merge-base"))).toBe(false);
  });

  it("refuses a Story with no branch", async () => {
    writeIssue("a", {
      kind: "story",
      title: "Story A",
      partOf: "e",
      merged: false,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });

    const result = await runIssueCli(["story", "update-from-merge-base", "a"], {
      env: env(),
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/update-from-merge-base requires branchName on Story "a"/);
    expect(existsSync(join(dir, "update-from-merge-base"))).toBe(false);
  });

  it("creates a Task with no sourceIdea", async () => {
    const result = await runIssueCli(["story", "update-from-merge-base", "a"], {
      env: env(),
    });
    expect(result.status).toBe(0);

    const task = JSON.parse(
      readFileSync(join(dir, "update-from-merge-base", "issue.json"), "utf8"),
    );
    expect(task.sourceIdea).toBeUndefined();
  });
});
