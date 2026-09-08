import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
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

const GIT = [
  "-c",
  "user.name=test",
  "-c",
  "user.email=test@example.com",
  "-c",
  "commit.gpgsign=false",
];

function git(repo: string, args: string[]): string {
  return execFileSync("git", [...GIT, ...args], {
    cwd: repo,
    encoding: "utf8",
  }).trim();
}

describe("archived field, cascade, and CLI filtering", () => {
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
      title: "Branch A",
      partOf: "e",
      merged: false,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeIssue("c1", {
      kind: "task",
      title: "C1",
      partOf: "a",
      status: "todo",
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
  });

  it("gets/sets archived on epic and cascades to descendants", async () => {
    expect((await runIssueCli(["epic", "get", "e", "archived"], { env: env() })).stdout).toBe("false\n");
    expect((await runIssueCli(["epic", "set", "e", "archived", "true"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["epic", "get", "e", "archived"], { env: env() })).stdout).toBe("true\n");
    expect((await runIssueCli(["story", "get", "a", "archived"], { env: env() })).stdout).toBe("true\n");
    expect((await runIssueCli(["task", "get", "c1", "archived"], { env: env() })).stdout).toBe("true\n");

    expect((await runIssueCli(["epic", "set", "e", "archived", "false"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["story", "get", "a", "archived"], { env: env() })).stdout).toBe("false\n");
    expect((await runIssueCli(["task", "get", "c1", "archived"], { env: env() })).stdout).toBe("false\n");
  });

  it("hides archived issues from tree/list unless --show-archived", async () => {
    expect((await runIssueCli(["epic", "set", "e", "archived", "true"], { env: env() })).status).toBe(0);

    const treeHidden = await runIssueCli(["tree", "p"], { env: env() });
    expect(treeHidden.status).toBe(0);
    expect(treeHidden.stdout).toContain("project p");
    expect(treeHidden.stdout).not.toContain("epic e");
    expect(treeHidden.stdout).not.toContain("story a");

    const treeShown = await runIssueCli(["tree", "p", "--show-archived"], { env: env() });
    expect(treeShown.status).toBe(0);
    expect(treeShown.stdout).toContain("epic e");
    expect(treeShown.stdout).toContain("story a");

    const listHidden = await runIssueCli(["list", "--in", "p"], { env: env() });
    expect(listHidden.status).toBe(0);
    const hiddenIds = JSON.parse(listHidden.stdout).issues.map(
      (issue: { id: string }) => issue.id,
    );
    expect(hiddenIds).toEqual(["p"]);

    const listShown = await runIssueCli(["list", "--in", "p", "--show-archived"], { env: env() });
    expect(listShown.status).toBe(0);
    const shownIds = JSON.parse(listShown.stdout).issues.map(
      (issue: { id: string }) => issue.id,
    );
    expect(shownIds.sort()).toEqual(["a", "c1", "e", "p"]);
  });

  it("creates a child under an archived parent as archived", async () => {
    expect((await runIssueCli(["epic", "set", "e", "archived", "true"], { env: env() })).status).toBe(0);
    const add = await runIssueCli(["story", "add", "Child", "--part-of", "e"], { env: env() });
    expect(add.status).toBe(0);
    const childId = add.stdout.trim();
    expect((await runIssueCli(["story", "get", childId, "archived"], { env: env() })).stdout).toBe("true\n");
  });

  it("refuses project set archived", async () => {
    const result = await runIssueCli(["project", "set", "p", "archived", "true"], { env: env() });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/unknown or unsettable field "archived"/);
  });
});

describe("attach / attachments / detach", () => {
  const AT = "2026-07-10T14:00:00.000Z";

  beforeEach(() => {
    writeIssue("p", { kind: "project", title: "Proj", order: 0, createdAt: AT, updatedAt: AT });
    writeIssue("e", {
      kind: "epic",
      title: "Epic",
      partOf: "p",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("a", {
      kind: "story",
      title: "Branch A",
      partOf: "e",
      order: 0,
      merged: false,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("c1", {
      kind: "task",
      title: "C1",
      partOf: "a",
      order: 0,
      status: "todo",
      createdAt: AT,
      updatedAt: AT,
    });
  });

  it("attaches, lists, unique-names on collision, and detaches on a commit", async () => {
    const source = join(dir, "fixture.tsx");
    writeFileSync(source, "export const x = 1;\n");

    const attach1 = await runIssueCli(["task", "attach", "c1", source], { env: env() });
    expect(attach1.status).toBe(0);
    expect(attach1.stdout).toContain("attached fixture.tsx (20 bytes)");
    expect(attach1.stdout).toContain(join(dir, "c1", "attachments", "fixture.tsx"));

    const list1 = await runIssueCli(["task", "attachments", "c1"], { env: env() });
    expect(list1.status).toBe(0);
    expect(list1.stdout).toBe("fixture.tsx\t20\n");

    writeFileSync(source, "export const x = 2;\n");
    const attach2 = await runIssueCli(["task", "attach", "c1", source], { env: env() });
    expect(attach2.status).toBe(0);
    expect(attach2.stdout).toContain("attached fixture-2.tsx (20 bytes)");
    expect(attach2.stdout).toContain(
      join(dir, "c1", "attachments", "fixture-2.tsx"),
    );
    expect(
      readFileSync(join(dir, "c1", "attachments", "fixture.tsx"), "utf8"),
    ).toBe("export const x = 1;\n");
    expect(
      readFileSync(join(dir, "c1", "attachments", "fixture-2.tsx"), "utf8"),
    ).toBe("export const x = 2;\n");

    const detach = await runIssueCli(["task", "detach", "c1", "fixture.tsx"], { env: env() });
    expect(detach.status).toBe(0);
    expect(detach.stdout).toBe("detached fixture.tsx from c1\n");
    expect((await runIssueCli(["task", "attachments", "c1"], { env: env() })).stdout).toBe("fixture-2.tsx\t20\n");

    expect((await runIssueCli(["task", "detach", "c1", "fixture-2.tsx"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["task", "attachments", "c1"], { env: env() })).stdout).toBe("(no attachments)\n");
  });

  it("allows attachments on epic and branch", async () => {
    const source = join(dir, "ui.png");
    writeFileSync(source, "png-bytes");

    expect((await runIssueCli(["epic", "attach", "e", source], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["story", "attach", "a", source], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["epic", "attachments", "e"], { env: env() })).stdout).toContain("ui.png\t9\n");
    expect((await runIssueCli(["story", "attachments", "a"], { env: env() })).stdout).toContain("ui.png\t9\n");
  });

  it("prints attachments in view when present and omits them when empty", async () => {
    const source = join(dir, "mock.tsx");
    writeFileSync(source, "canvas");
    expect((await runIssueCli(["task", "attach", "c1", source], { env: env() })).status).toBe(0);

    const withAttachments = await runIssueCli(["task", "view", "c1"], { env: env() });
    expect(withAttachments.status).toBe(0);
    expect(withAttachments.stdout).toContain("Attachments:");
    expect(withAttachments.stdout).toContain(
      `mock.tsx (6 bytes) — ${join(dir, "c1", "attachments", "mock.tsx")}`,
    );

    expect((await runIssueCli(["task", "detach", "c1", "mock.tsx"], { env: env() })).status).toBe(0);
    const withoutAttachments = await runIssueCli(["task", "view", "c1"], { env: env() });
    expect(withoutAttachments.status).toBe(0);
    expect(withoutAttachments.stdout).not.toContain("Attachments:");
  });

  it("prints project attachments in view when present and omits them when empty", async () => {
    const source = join(dir, "vision.md");
    writeFileSync(source, "# Vision");
    expect((await runIssueCli(["project", "attach", "p", source], { env: env() })).status).toBe(0);

    const withAttachments = await runIssueCli(["project", "view", "p"], { env: env() });
    expect(withAttachments.status).toBe(0);
    expect(withAttachments.stdout).toContain("Attachments:");
    expect(withAttachments.stdout).toContain(
      `vision.md (8 bytes) — ${join(dir, "p", "attachments", "vision.md")}`,
    );

    expect((await runIssueCli(["project", "detach", "p", "vision.md"], { env: env() })).status).toBe(0);
    const withoutAttachments = await runIssueCli(["project", "view", "p"], { env: env() });
    expect(withoutAttachments.status).toBe(0);
    expect(withoutAttachments.stdout).not.toContain("Attachments:");
  });

  it("prints attachments in summary when present and omits them when empty", async () => {
    const source = join(dir, "mock.tsx");
    writeFileSync(source, "canvas");
    expect((await runIssueCli(["task", "attach", "c1", source], { env: env() })).status).toBe(0);

    const withAttachments = await runIssueCli(["summary", "c1"], { env: env() });
    expect(withAttachments.status).toBe(0);
    expect(withAttachments.stdout).toContain("  Attachments:");
    expect(withAttachments.stdout).toContain(
      `mock.tsx (6 bytes) — ${join(dir, "c1", "attachments", "mock.tsx")}`,
    );

    expect((await runIssueCli(["task", "detach", "c1", "mock.tsx"], { env: env() })).status).toBe(0);
    const withoutAttachments = await runIssueCli(["summary", "c1"], { env: env() });
    expect(withoutAttachments.status).toBe(0);
    expect(withoutAttachments.stdout).not.toContain("Attachments:");
  });
});

describe("kind-scoped view / delete / comment / attach", () => {
  beforeEach(() => {
    writeIssue("p", { kind: "project", title: "Proj", createdAt: nextAt(), updatedAt: nextAt() });
    writeIssue("idea-1", {
      kind: "idea",
      title: "Idea",
      partOf: "p",
      order: 0,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeIssue("e", {
      kind: "epic",
      title: "Epic",
      partOf: "p",
      order: 1,
      blockedBy: [],
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeIssue("a", {
      kind: "story",
      title: "Story A",
      partOf: "e",
      order: 0,
      branchName: "feat/a",
      merged: false,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeIssue("c1", {
      kind: "task",
      title: "C1",
      partOf: "a",
      order: 0,
      status: "todo",
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeFileSync(join(dir, "a", "description.md"), "# Story A\n\nthe body\n");
    writeFileSync(
      join(dir, "a", "comments.jsonl"),
      JSON.stringify({ id: "c1", role: "agent", name: "bot", body: "first note", at: nextAt() }) +
        "\n",
    );
  });

  it.each([
    { kind: "project", id: "p" },
    { kind: "idea", id: "idea-1" },
    { kind: "epic", id: "e" },
    { kind: "story", id: "a" },
    { kind: "task", id: "c1" },
  ])("views a $kind via kind-scoped view", async ({ kind, id }) => {
    const { stdout, status } = await runIssueCli([kind, "view", id], { env: env() });
    expect(status).toBe(0);
    expect(stdout).toContain(`kind: ${kind}`);
  });

  it("supports --comments on kind-scoped view", async () => {
    const { stdout, status } = await runIssueCli(["story", "view", "a", "--comments"], { env: env() });
    expect(status).toBe(0);
    expect(stdout).toContain("--- comments ---");
    expect(stdout).toContain("bot: first note");
  });

  it("groups threads and renders anchors on view --comments", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "issue-cli-anchor-ws-"));
    try {
      git(workspace, ["init", "-b", "main"]);
      const relPath = "src/review.ts";
      const absPath = join(workspace, relPath);
      mkdirSync(dirname(absPath), { recursive: true });
      writeFileSync(absPath, "line one\nline two\nline three\n");
      git(workspace, ["add", "-A"]);
      git(workspace, ["commit", "-m", "initial"]);
      const shaInitial = git(workspace, ["rev-parse", "HEAD"]);
      writeFileSync(absPath, "line one\nLINE TWO\nline three\n");
      git(workspace, ["add", "-A"]);
      git(workspace, ["commit", "-m", "change line two"]);
      const shaChanged = git(workspace, ["rev-parse", "HEAD"]);

      writeIssue("p", {
        kind: "project",
        title: "Proj",
        workspace,
        createdAt: nextAt(),
        updatedAt: nextAt(),
      });
      writeIssue("c1", {
        kind: "task",
        title: "C1",
        partOf: "a",
        order: 0,
        status: "done",
        commits: [shaInitial, shaChanged],
        createdAt: nextAt(),
        updatedAt: nextAt(),
      });

      const at = nextAt();
      writeFileSync(
        join(dir, "a", "comments.jsonl"),
        [
          JSON.stringify({
            id: "plain-id",
            role: "human",
            name: "Ada",
            body: "standalone note",
            at,
          }),
          JSON.stringify({
            id: "current-id",
            role: "agent",
            name: "reviewer",
            body: "still valid",
            at,
            anchor: {
              path: relPath,
              side: "new",
              line: 1,
              commitSha: shaInitial,
            },
          }),
          JSON.stringify({
            id: "outdated-id",
            role: "agent",
            name: "reviewer",
            body: "fix this",
            at,
            anchor: {
              path: relPath,
              side: "new",
              line: 2,
              commitSha: shaInitial,
            },
          }),
          JSON.stringify({
            id: "reply-id",
            role: "agent",
            body: "will do",
            at,
            replyTo: "outdated-id",
          }),
        ].join("\n") + "\n",
      );

      const { stdout, status } = await runIssueCli(["story", "view", "a", "--comments"], {
        env: env(),
      });
      expect(status).toBe(0);

      const comments = stdout.split("--- comments ---")[1]!.trim().split("\n");
      expect(comments).toEqual([
        `plain-id [${at}] Ada: standalone note`,
        `current-id [${at}] reviewer @ ${relPath}:1 new ${shaInitial.slice(0, 7)}: still valid`,
        `outdated-id [${at}] reviewer @ ${relPath}:2 new ${shaInitial.slice(0, 7)} (outdated): fix this`,
        `  reply-id [${at}] agent: will do`,
      ]);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it.each([
    {
      name: "epic view",
      cmd: () => ["epic", "view", "a"],
      error: '"a" is a story, not an epic',
    },
    {
      name: "story delete",
      cmd: () => ["story", "delete", "e"],
      error: '"e" is an epic, not a story',
    },
    {
      name: "task comment",
      cmd: () => ["task", "comment", "a", "--role", "agent", "--body", "x"],
      error: '"a" is a story, not a task',
    },
    {
      name: "idea attach",
      cmd: () => {
        const file = join(dir, "mismatch-attach.txt");
        writeFileSync(file, "x");
        return ["idea", "attach", "e", file];
      },
      error: '"e" is an epic, not an idea',
    },
  ])("refuses kind mismatch for $name", async ({ cmd, error }) => {
    const { stderr, status } = await runIssueCli(cmd(), { env: env() });
    expect(status).toBe(1);
    expect(stderr).toContain(error);
  });

  it("comments on epic/idea/story/task via kind-scoped comment", async () => {
    for (const [kind, id] of [
      ["epic", "e"],
      ["idea", "idea-1"],
      ["story", "a"],
      ["task", "c1"],
    ] as const) {
      const { stdout, status } = await runIssueCli([
        kind,
        "comment",
        id,
        "--role",
        "agent",
        "--body",
        `note on ${id}`,
      ], { env: env() });
      expect(status, kind).toBe(0);
      expect(stdout, kind).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\n$/,
      );
      expect(readFileSync(join(dir, id, "comments.jsonl"), "utf8")).toContain(
        `note on ${id}`,
      );
    }
  });

  it("does not register comment under project", async () => {
    const help = await runIssueCli(["project", "--help"], { env: env() });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("trunk");
    expect(help.stdout).not.toMatch(/\n {2}comment\b/);
    const { stderr, status } = await runIssueCli([
      "project",
      "comment",
      "p",
      "--role",
      "agent",
      "--body",
      "nope",
    ], { env: env() });
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/unknown command 'comment'/);
  });

  it("attaches on idea/epic/story/task via kind-scoped attach", async () => {
    const source = join(dir, "note.txt");
    writeFileSync(source, "hello");
    for (const [kind, id] of [
      ["idea", "idea-1"],
      ["epic", "e"],
      ["story", "a"],
      ["task", "c1"],
    ] as const) {
      const attach = await runIssueCli([kind, "attach", id, source], { env: env() });
      expect(attach.status, kind).toBe(0);
      expect(attach.stdout, kind).toContain("attached note.txt");
      const list = await runIssueCli([kind, "attachments", id], { env: env() });
      expect(list.status, kind).toBe(0);
      expect(list.stdout, kind).toContain("note.txt\t5");
      const detach = await runIssueCli([kind, "detach", id, "note.txt"], { env: env() });
      expect(detach.status, kind).toBe(0);
      expect(detach.stdout, kind).toBe(`detached note.txt from ${id}\n`);
    }
  });

  it("attaches on project via kind-scoped attach", async () => {
    const source = join(dir, "note.txt");
    writeFileSync(source, "hello");
    const attach = await runIssueCli(["project", "attach", "p", source], { env: env() });
    expect(attach.status).toBe(0);
    expect(attach.stdout).toContain("attached note.txt");
    const list = await runIssueCli(["project", "attachments", "p"], { env: env() });
    expect(list.status).toBe(0);
    expect(list.stdout).toContain("note.txt\t5");
    const detach = await runIssueCli(["project", "detach", "p", "note.txt"], { env: env() });
    expect(detach.status).toBe(0);
    expect(detach.stdout).toBe("detached note.txt from p\n");
  });

  it("deletes via kind-scoped delete", async () => {
    writeIssue("c2", {
      kind: "task",
      title: "C2",
      partOf: "a",
      order: 1,
      status: "todo",
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    const { stdout, status } = await runIssueCli(["task", "delete", "c2"], { env: env() });
    expect(status).toBe(0);
    expect(stdout).toContain("deleted c2");
    expect((await runIssueCli(["task", "view", "c2"], { env: env() })).status).toBe(1);
  });
});

describe("bare-id view / get / comment / attach", () => {
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
      title: "Story A",
      partOf: "e",
      order: 0,
      branchName: "feat/a",
      merged: false,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeIssue("c1", {
      kind: "task",
      title: "C1",
      partOf: "a",
      order: 0,
      status: "todo",
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeFileSync(join(dir, "e", "description.md"), "# Epic\n\nepic body\n");
    writeFileSync(join(dir, "a", "description.md"), "# Story A\n\nthe body\n");
    writeFileSync(
      join(dir, "a", "comments.jsonl"),
      JSON.stringify({ id: "c1", role: "agent", name: "bot", body: "first note", at: nextAt() }) +
        "\n",
    );
  });

  it("views epic and story ids without a kind prefix", async () => {
    const epic = await runIssueCli(["view", "e"], { env: env() });
    expect(epic.status).toBe(0);
    expect(epic.stdout).toContain("kind: epic");
    expect(epic.stdout).toContain("title: Epic");
    expect(epic.stdout).toContain("# Epic");

    const story = await runIssueCli(["view", "a"], { env: env() });
    expect(story.status).toBe(0);
    expect(story.stdout).toContain("kind: story");
    expect(story.stdout).toContain("title: Story A");
    expect(story.stdout).toContain("# Story A");
    expect(story.stdout).not.toContain("--- comments ---");

    const withComments = await runIssueCli(["view", "a", "--comments"], { env: env() });
    expect(withComments.status).toBe(0);
    expect(withComments.stdout).toContain("--- comments ---");
    expect(withComments.stdout).toContain("bot: first note");
  });

  it("gets epic and story fields without a kind prefix", async () => {
    expect((await runIssueCli(["get", "e", "title"], { env: env() })).stdout).toBe("Epic\n");
    expect((await runIssueCli(["get", "e", "description"], { env: env() })).stdout).toBe("# Epic\n\nepic body\n");
    expect((await runIssueCli(["get", "a", "title"], { env: env() })).stdout).toBe("Story A\n");
    expect((await runIssueCli(["get", "a", "branchName"], { env: env() })).stdout).toBe("feat/a\n");
  });

  it("round-trips attach / attachments / detach without a kind prefix", async () => {
    const source = join(dir, "note.txt");
    writeFileSync(source, "hello");

    const attach = await runIssueCli(["attach", "c1", source], { env: env() });
    expect(attach.status).toBe(0);
    expect(attach.stdout).toContain("attached note.txt");

    const list = await runIssueCli(["attachments", "c1"], { env: env() });
    expect(list.status).toBe(0);
    expect(list.stdout).toBe("note.txt\t5\n");

    const detach = await runIssueCli(["detach", "c1", "note.txt"], { env: env() });
    expect(detach.status).toBe(0);
    expect(detach.stdout).toBe("detached note.txt from c1\n");
    expect((await runIssueCli(["attachments", "c1"], { env: env() })).stdout).toBe("(no attachments)\n");
  });

  it("writes the same chat entry as the kind-scoped comment form", async () => {
    const bare = await runIssueCli([
      "comment",
      "a",
      "--role",
      "implementor",
      "--body",
      "bare-id note",
      "--name",
      "impl",
    ], { env: env() });
    expect(bare.status).toBe(0);
    expect(bare.stdout).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\n$/,
    );

    const scoped = await runIssueCli([
      "story",
      "comment",
      "a",
      "--role",
      "implementor",
      "--body",
      "kind-scoped note",
      "--name",
      "impl",
    ], { env: env() });
    expect(scoped.status).toBe(0);
    expect(scoped.stdout).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\n$/,
    );

    const chat = readFileSync(join(dir, "a", "comments.jsonl"), "utf8");
    expect(chat).toContain('"body":"bare-id note"');
    expect(chat).toContain('"body":"kind-scoped note"');
    expect(chat).toContain('"role":"implementor"');
  });

  it("errors on an unknown id", async () => {
    const view = await runIssueCli(["view", "ghost"], { env: env() });
    expect(view.status).toBe(1);
    expect(view.stderr).toContain('unknown issue "ghost"');

    const get = await runIssueCli(["get", "ghost", "title"], { env: env() });
    expect(get.status).toBe(1);
    expect(get.stderr).toContain('unknown issue "ghost"');

    const comment = await runIssueCli([
      "comment",
      "ghost",
      "--role",
      "agent",
      "--body",
      "x",
    ], { env: env() });
    expect(comment.status).toBe(1);
    expect(comment.stderr).toContain('unknown issue "ghost"');
  });

  it("refuses bare-id comment on a project id", async () => {
    const { stderr, status } = await runIssueCli([
      "comment",
      "p",
      "--role",
      "agent",
      "--body",
      "nope",
    ], { env: env() });
    expect(status).toBe(1);
    expect(stderr).toContain('"p" is a Project');
    expect(stderr).toContain("projects have no comment log");
  });

  it("still errors on kind-scoped calls against a mismatched kind", async () => {
    const view = await runIssueCli(["epic", "view", "a"], { env: env() });
    expect(view.status).toBe(1);
    expect(view.stderr).toContain('"a" is a story, not an epic');

    const get = await runIssueCli(["story", "get", "e", "title"], { env: env() });
    expect(get.status).toBe(1);
    expect(get.stderr).toContain('"e" is an epic, not a story');

    const attachFile = join(dir, "mismatch.txt");
    writeFileSync(attachFile, "x");
    const attach = await runIssueCli(["task", "attach", "a", attachFile], { env: env() });
    expect(attach.status).toBe(1);
    expect(attach.stderr).toContain('"a" is a story, not a task');
  });
});

describe("project labels catalog and assignments", () => {
  beforeEach(() => {
    writeIssue("p", {
      kind: "project",
      title: "Proj",
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeIssue("e", {
      kind: "epic",
      title: "Epic",
      partOf: "p",
      blockedBy: [],
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeIssue("idea-a", {
      kind: "idea",
      title: "Idea",
      partOf: "p",
      order: 1,
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

  function catalogOf(): Array<{ id: string; color: string; description?: string }> {
    return issueJsonField("p", "labels") ?? [];
  }

  function labelsOf(id: string): string[] {
    return issueJsonField(id, "labels") ?? [];
  }

  async function seedCatalog(
    ...labels: Array<{ id: string; color: string; description?: string }>
  ): Promise<void> {
    for (const label of labels) {
      expect(
        (await runIssueCli(["project", "set", "p", "labels", "--add", JSON.stringify(label)], { env: env() }))
          .status,
      ).toBe(0);
    }
  }

  it("adds, updates, removes, renames, and clears the project catalog", async () => {
    const bug = JSON.stringify({ id: "bug", color: "#ff0000" });
    expect((await runIssueCli(["project", "set", "p", "labels", "--add", bug], { env: env() })).status).toBe(0);
    expect(catalogOf()).toEqual([{ id: "bug", color: "#ff0000" }]);
    expect((await runIssueCli(["project", "get", "p", "labels"], { env: env() })).stdout).toBe(
      '[{"id":"bug","color":"#ff0000"}]\n',
    );

    const updated = JSON.stringify({
      id: "bug",
      color: "#aa0000",
      description: "Defects",
    });
    expect((await runIssueCli(["project", "set", "p", "labels", "--add", updated], { env: env() })).status).toBe(
      0,
    );
    expect(catalogOf()).toEqual([
      { id: "bug", color: "#aa0000", description: "Defects" },
    ]);

    const featPath = join(dir, "feat.json");
    writeFileSync(
      featPath,
      JSON.stringify({ id: "feat", color: "#00ff00" }),
    );
    expect(
      (await runIssueCli(["project", "set", "p", "labels", "--add", "--file", featPath], { env: env() })).status,
    ).toBe(0);
    expect(catalogOf().map((l) => l.id)).toEqual(["bug", "feat"]);

    expect(
      (await runIssueCli(["project", "set", "p", "labels", "--file", "-", "--add"], { env: env(), stdin: '{"id":"chore","color":"#0000ff"}' }))
        .status,
    ).toBe(0);
    expect(catalogOf().map((l) => l.id)).toEqual(["bug", "feat", "chore"]);

    expect((await runIssueCli(["project", "set", "p", "labels", "--remove", "chore"], { env: env() })).status).toBe(
      0,
    );
    expect(catalogOf().map((l) => l.id)).toEqual(["bug", "feat"]);

    expect(
      (await runIssueCli(["project", "set", "p", "labels", "--rename", "bug", "defect"], { env: env() })).status,
    ).toBe(0);
    expect(catalogOf().map((l) => l.id)).toEqual(["defect", "feat"]);

    expect((await runIssueCli(["project", "set", "p", "labels", "--clear"], { env: env() })).status).toBe(0);
    expect(catalogOf()).toEqual([]);
    expect((await runIssueCli(["project", "get", "p", "labels"], { env: env() })).stdout).toBe("[]\n");
  });

  it("assigns, removes, and clears labels on epic/idea/story", async () => {
    await seedCatalog(
      { id: "bug", color: "#ff0000" },
      { id: "feat", color: "#00ff00" },
    );

    expect((await runIssueCli(["epic", "set", "e", "labels", "--add", "bug", "feat"], { env: env() })).status).toBe(
      0,
    );
    expect(labelsOf("e")).toEqual(["bug", "feat"]);
    expect((await runIssueCli(["epic", "get", "e", "labels"], { env: env() })).stdout).toBe('["bug","feat"]\n');

    expect((await runIssueCli(["idea", "set", "idea-a", "labels", "--add", "feat"], { env: env() })).status).toBe(
      0,
    );
    expect(labelsOf("idea-a")).toEqual(["feat"]);

    expect((await runIssueCli(["story", "set", "a", "labels", "--add", "bug"], { env: env() })).status).toBe(0);
    expect(labelsOf("a")).toEqual(["bug"]);

    expect((await runIssueCli(["epic", "set", "e", "labels", "--remove", "bug"], { env: env() })).status).toBe(0);
    expect(labelsOf("e")).toEqual(["feat"]);

    expect((await runIssueCli(["story", "set", "a", "labels", "--clear"], { env: env() })).status).toBe(0);
    expect(labelsOf("a")).toEqual([]);
    expect((await runIssueCli(["story", "get", "a", "labels"], { env: env() })).stdout).toBe("[]\n");
  });

  it("refuses unknown assignment ids", async () => {
    await seedCatalog({ id: "bug", color: "#ff0000" });
    const refused = await runIssueCli(["epic", "set", "e", "labels", "--add", "ghost"], { env: env() });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toMatch(/unknown catalog id/);
    expect(labelsOf("e")).toEqual([]);
  });

  it("cascades catalog remove and rename onto assignments", async () => {
    await seedCatalog(
      { id: "bug", color: "#ff0000" },
      { id: "feat", color: "#00ff00" },
    );
    expect((await runIssueCli(["epic", "set", "e", "labels", "--add", "bug", "feat"], { env: env() })).status).toBe(
      0,
    );
    expect((await runIssueCli(["story", "set", "a", "labels", "--add", "bug"], { env: env() })).status).toBe(0);

    expect((await runIssueCli(["project", "set", "p", "labels", "--remove", "bug"], { env: env() })).status).toBe(
      0,
    );
    expect(labelsOf("e")).toEqual(["feat"]);
    expect(labelsOf("a")).toEqual([]);

    expect((await runIssueCli(["epic", "set", "e", "labels", "--add", "feat"], { env: env() })).status).toBe(0);
    expect(
      (await runIssueCli(["project", "set", "p", "labels", "--rename", "feat", "feature"], { env: env() })).status,
    ).toBe(0);
    expect(labelsOf("e")).toEqual(["feature"]);
    expect(catalogOf().map((l) => l.id)).toEqual(["feature"]);
  });

  it("prints labels on view and tree chips, and omits them from summary", async () => {
    await seedCatalog(
      { id: "bug", color: "#ff0000" },
      { id: "feat", color: "#00ff00" },
    );
    expect((await runIssueCli(["epic", "set", "e", "labels", "--add", "bug", "feat"], { env: env() })).status).toBe(
      0,
    );
    expect((await runIssueCli(["idea", "set", "idea-a", "labels", "--add", "feat"], { env: env() })).status).toBe(
      0,
    );
    expect((await runIssueCli(["story", "set", "a", "labels", "--add", "bug"], { env: env() })).status).toBe(0);

    const projectView = await runIssueCli(["project", "view", "p"], { env: env() });
    expect(projectView.status).toBe(0);
    expect(projectView.stdout).toContain("labels: bug, feat");

    const epicView = await runIssueCli(["epic", "view", "e"], { env: env() });
    expect(epicView.status).toBe(0);
    expect(epicView.stdout).toContain("labels: bug, feat");

    const ideaView = await runIssueCli(["idea", "view", "idea-a"], { env: env() });
    expect(ideaView.status).toBe(0);
    expect(ideaView.stdout).toContain("labels: feat");

    const storyView = await runIssueCli(["story", "view", "a"], { env: env() });
    expect(storyView.status).toBe(0);
    expect(storyView.stdout).toContain("labels: bug");

    expect((await runIssueCli(["epic", "set", "e", "labels", "--clear"], { env: env() })).status).toBe(0);
    const clearedView = await runIssueCli(["epic", "view", "e"], { env: env() });
    expect(clearedView.status).toBe(0);
    expect(clearedView.stdout).not.toContain("labels:");
    expect((await runIssueCli(["epic", "set", "e", "labels", "--add", "bug", "feat"], { env: env() })).status).toBe(
      0,
    );

    const tree = await runIssueCli(["tree", "p"], { env: env() });
    expect(tree.status).toBe(0);
    expect(tree.stdout).toMatch(/^ {2}epic e\b.*\blabels=bug,feat\b/m);
    expect(tree.stdout).toMatch(/^ {2}idea idea-a\b.*\blabels=feat\b/m);
    expect(tree.stdout).toMatch(/^ {4}story a\b.*\blabels=bug\b/m);

    const summary = await runIssueCli(["summary", "a"], { env: env() });
    expect(summary.status).toBe(0);
    expect(summary.stdout).not.toMatch(/\blabels\b/);
  });
});
