import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { runIssueCli } from "./cli-program.js";
import {
  blockedByOf,
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
      kind: "epic",
      args: ["epic", "add", "--part-of", "p", "Child Epic", "--assignee", "alice"],
    },
  ])("rejects $kind add with --assignee", async ({ args }) => {
    const result = await runIssueCli(args, { env: env() });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/unknown option '--assignee'/);
  });

  it("seeds description from --file without --description-file", async () => {
    const descFile = join(dir, "seed.md");
    writeFileSync(descFile, "# From file\n");
    const fromFile = await runIssueCli([
      "epic",
      "add",
      "--part-of",
      "p",
      "File Desc",
      "--file",
      descFile,
    ], { env: env() });
    expect(fromFile.status).toBe(0);
    expect(readFileSync(join(dir, "file-desc", "description.md"), "utf8")).toBe(
      "# From file\n",
    );
  });

  it.each([
    {
      kind: "epic",
      args: ["epic", "add", "--part-of", "a", "Nope"],
      error: /must be a project/,
    },
  ])("rejects a bad parent for $kind", async ({ args, error }) => {
    const result = await runIssueCli(args, { env: env() });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(error);
  });
});

describe("epic get/set", () => {
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
    writeIssue("blocker", {
      kind: "epic",
      title: "Blocker",
      partOf: "p",
      order: 1,
      blockedBy: [],
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeIssue("other", {
      kind: "epic",
      title: "Other",
      partOf: "p",
      order: 2,
      blockedBy: [],
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeFileSync(join(dir, "e", "description.md"), "# Epic\n\nbody\n");
  });

  it("gets and sets allowlisted epic fields", async () => {
    expect((await runIssueCli(["epic", "get", "e", "title"], { env: env() })).stdout).toBe("Epic\n");
    expect((await runIssueCli(["epic", "get", "e", "description"], { env: env() })).stdout).toBe("# Epic\n\nbody\n");
    expect((await runIssueCli(["epic", "get", "e", "blockedBy"], { env: env() })).stdout).toBe("[]\n");

    expect((await runIssueCli(["epic", "set", "e", "title", "Renamed"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["epic", "get", "e", "title"], { env: env() })).stdout).toBe("Renamed\n");

    const unknownAssigneeGet = await runIssueCli(["epic", "get", "e", "assignee"], { env: env() });
    expect(unknownAssigneeGet.status).toBe(1);
    expect(unknownAssigneeGet.stderr).toContain('unknown field "assignee" for epic');
    const unknownAssigneeSet = await runIssueCli(["epic", "set", "e", "assignee", "bot"], { env: env() });
    expect(unknownAssigneeSet.status).toBe(1);
    expect(unknownAssigneeSet.stderr).toContain(
      'unknown or unsettable field "assignee" for epic',
    );

    expect(
      (await runIssueCli(["epic", "set", "e", "needsAttention", "true", "--reason", "need decision"], { env: env() })).status,
    ).toBe(0);
    expect((await runIssueCli(["epic", "get", "e", "needsAttention"], { env: env() })).stdout).toBe("true\n");
    expect((await runIssueCli(["epic", "get", "e", "attentionReason"], { env: env() })).stdout).toBe("need decision\n");
    expect((await runIssueCli(["epic", "set", "e", "needsAttention", "false"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["epic", "get", "e", "needsAttention"], { env: env() })).stdout).toBe("false\n");
    expect((await runIssueCli(["epic", "get", "e", "attentionReason"], { env: env() })).stdout).toBe("");

    expect((await runIssueCli(["epic", "set", "e", "retro", "in-progress"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["epic", "get", "e", "retro"], { env: env() })).stdout).toBe("in-progress\n");
    expect((await runIssueCli(["epic", "set", "e", "retro", "done"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["epic", "get", "e", "retro"], { env: env() })).stdout).toBe("done\n");
    expect((await runIssueCli(["epic", "set", "e", "retro", "--clear"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["epic", "get", "e", "retro"], { env: env() })).stdout).toBe("");

    const invalidRetro = await runIssueCli(["epic", "set", "e", "retro", "pending"], { env: env() });
    expect(invalidRetro.status).toBe(1);
    expect(invalidRetro.stderr).toMatch(/invalid retro "pending"/);
  });

  it("replaces and incrementally edits blockedBy", async () => {
    expect(
      (await runIssueCli(["epic", "set", "e", "blockedBy", '["blocker"]'], { env: env() })).status,
    ).toBe(0);
    expect(blockedByOf("e")).toEqual(["blocker"]);
    expect((await runIssueCli(["epic", "get", "e", "blockedBy"], { env: env() })).stdout).toBe('["blocker"]\n');

    expect((await runIssueCli(["epic", "set", "e", "blockedBy", "--add", "other"], { env: env() })).status).toBe(0);
    expect(blockedByOf("e").sort()).toEqual(["blocker", "other"]);

    // --add is idempotent for ids already present.
    expect((await runIssueCli(["epic", "set", "e", "blockedBy", "--add", "blocker", "other"], { env: env() })).status).toBe(
      0,
    );
    expect(blockedByOf("e").sort()).toEqual(["blocker", "other"]);

    expect((await runIssueCli(["epic", "set", "e", "blockedBy", "--remove", "blocker"], { env: env() })).status).toBe(0);
    expect(blockedByOf("e")).toEqual(["other"]);

    expect((await runIssueCli(["epic", "set", "e", "blockedBy", "--clear"], { env: env() })).status).toBe(0);
    expect(blockedByOf("e")).toEqual([]);
    expect((await runIssueCli(["epic", "get", "e", "blockedBy"], { env: env() })).stdout).toBe("[]\n");
  });

  it("rejects invalid blockedBy set modes and wrong kind", async () => {
    expect((await runIssueCli(["epic", "set", "e", "blockedBy", '["blocker"]'], { env: env() })).status).toBe(0);

    const combined = await runIssueCli([
      "epic",
      "set",
      "e",
      "blockedBy",
      '["other"]',
      "--add",
      "blocker",
    ], { env: env() });
    expect(combined.status).toBe(1);
    expect(combined.stderr).toMatch(/mutually exclusive/);
    expect(blockedByOf("e")).toEqual(["blocker"]);

    const missing = await runIssueCli(["epic", "set", "e", "blockedBy"], { env: env() });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toMatch(
      /provide a JSON array value, --file, --add, --remove, or --clear for blockedBy/,
    );

    writeIssue("br", {
      kind: "story",
      title: "Branch",
      partOf: "e",
      merged: false,
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    const wrongKind = await runIssueCli(["epic", "set", "br", "blockedBy", "--add", "blocker"], { env: env() });
    expect(wrongKind.status).toBe(1);
    expect(wrongKind.stderr).toMatch(/"br" is a story, not an epic/);
  });

  it("gets derived epicStatus and blocked", async () => {
    expect((await runIssueCli(["epic", "get", "e", "epicStatus"], { env: env() })).stdout).toBe("todo\n");
    expect((await runIssueCli(["epic", "get", "e", "blocked"], { env: env() })).stdout).toBe("false\n");

    expect((await runIssueCli(["epic", "set", "e", "blockedBy", '["blocker"]'], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["epic", "get", "e", "blocked"], { env: env() })).stdout).toBe("true\n");

    writeIssue("br", {
      kind: "story",
      title: "Branch",
      partOf: "e",
      merged: false,
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    expect((await runIssueCli(["epic", "get", "e", "epicStatus"], { env: env() })).stdout).toBe("todo\n");

    writeIssue("br", {
      kind: "story",
      title: "Branch",
      partOf: "e",
      branchName: "feat",
      merged: false,
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    expect((await runIssueCli(["epic", "get", "e", "epicStatus"], { env: env() })).stdout).toBe("in-progress\n");
  });

  it("preserves retro across apply", async () => {
    expect((await runIssueCli(["epic", "set", "e", "retro", "in-progress"], { env: env() })).status).toBe(0);

    const applyPath = join(dir, "epic-apply.yaml");
    writeFileSync(
      applyPath,
      `project: p
epic:
  id: e
  title: Epic renamed
  children: []
`,
    );
    expect((await runIssueCli(["apply", applyPath], { env: env() })).status).toBe(0);
    const onDisk = JSON.parse(readFileSync(join(dir, "e", "issue.json"), "utf8"));
    expect(onDisk.retro).toBe("in-progress");
    expect(onDisk.title).toBe("Epic renamed");
  });

  it("refuses kind mismatch and unknown fields", async () => {
    const mismatch = await runIssueCli(["epic", "get", "p", "title"], { env: env() });
    expect(mismatch.status).toBe(1);
    expect(mismatch.stderr).toContain('"p" is a project, not an epic');

    const unknownGet = await runIssueCli(["epic", "get", "e", "workspace"], { env: env() });
    expect(unknownGet.status).toBe(1);
    expect(unknownGet.stderr).toContain('unknown field "workspace" for epic');

    const removedReady = await runIssueCli(["epic", "get", "e", "ready"], { env: env() });
    expect(removedReady.status).toBe(1);
    expect(removedReady.stderr).toContain('unknown field "ready" for epic');

    const unknownSet = await runIssueCli(["epic", "set", "e", "workspace", "/tmp"], { env: env() });
    expect(unknownSet.status).toBe(1);
    expect(unknownSet.stderr).toContain(
      'unknown or unsettable field "workspace" for epic',
    );
  });
});
