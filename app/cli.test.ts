import { spawnSync } from "child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DELETED_FIELD_VERBS } from "./deleted-field-verbs.js";

// Drive the real CLI as a subprocess against a throwaway ISSUES_DIR. Verb
// behavior (stdin, exit codes, stdout formatting, service round-trips) only
// exists once commander has parsed argv, so these tests exercise the whole
// path end to end rather than importing the side-effectful cli.ts module.
const appDir = dirname(fileURLToPath(import.meta.url));
const tsx = join(appDir, "node_modules", ".bin", "tsx");
const cliPath = join(appDir, "cli.ts");

let dir: string;
let clock = 0;

function nextAt(): string {
  clock += 1;
  return new Date(Date.UTC(2026, 6, 10, 14, 0, clock)).toISOString();
}

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function runCli(
  args: string[],
  input?: string,
): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(tsx, [cliPath, ...args], {
    cwd: appDir,
    env: { ...process.env, ISSUES_DIR: dir },
    input,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status,
  };
}

function makeGitWorkspace(): string {
  const ws = mkdtempSync(join(tmpdir(), "issue-cli-workspace-"));
  mkdirSync(join(ws, ".git"));
  return ws;
}

function issueJsonField<T>(id: string, key: string): T {
  const raw = JSON.parse(readFileSync(join(dir, id, "issue.json"), "utf8"));
  return raw[key];
}

function blockedByOf(id: string): string[] {
  return issueJsonField(id, "blockedBy");
}

function mergeBaseOf(id: string): string | undefined {
  return issueJsonField(id, "mergeBase");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-cli-"));
  clock = 0;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("removed commands", () => {
  it("rejects the removed ready command", () => {
    const { status, stderr } = runCli(["ready", "--project", "p"]);
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/unknown command/i);
  });
});

describe("--file - reads stdin on create", () => {
  it("seeds description.md from piped stdin through the create service", () => {
    const { stdout, status } = runCli(
      ["project", "add", "Stdin Project", "--file", "-"],
      "# Piped description\n\nfrom stdin\n",
    );
    expect(status).toBe(0);
    const id = stdout.trim();
    expect(id).toBeTruthy();
    const description = readFileSync(join(dir, id, "description.md"), "utf8");
    expect(description).toBe("# Piped description\n\nfrom stdin\n");
  });
});

describe("summary", () => {
  beforeEach(() => {
    writeIssue("p", { kind: "project", title: "Proj", createdAt: nextAt(), updatedAt: nextAt() });
    writeIssue("e", { kind: "epic", title: "Epic", partOf: "p", createdAt: nextAt(), updatedAt: nextAt() });
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
      title: "Do the thing",
      partOf: "a",
      status: "todo",
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
  });

  it("wires the verb through to formatted stdout", () => {
    const { stdout, status } = runCli(["summary", "c1"]);
    expect(status).toBe(0);
    expect(stdout).toContain("Task: c1 — Do the thing");
    expect(stdout).toContain("For more details, try `issue <kind> view <id>` or `issue tree`.");
  });

  it("errors with a nonzero exit on an unknown id", () => {
    const { stderr, status } = runCli(["summary", "ghost"]);
    expect(status).toBe(1);
    expect(stderr).toContain('unknown issue "ghost"');
  });

  it("prints Workspace when set on the project", () => {
    const ws = makeGitWorkspace();
    try {
      expect(runCli(["project", "set", "p", "workspace", ws]).status).toBe(0);
      const { stdout, status } = runCli(["summary", "c1"]);
      expect(status).toBe(0);
      expect(stdout).toContain(`  Workspace: ${ws}`);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it("omits Workspace when unset on the project", () => {
    const { stdout, status } = runCli(["summary", "c1"]);
    expect(status).toBe(0);
    expect(stdout).not.toContain("Workspace:");
  });
});

describe("view", () => {
  beforeEach(() => {
    writeIssue("p", { kind: "project", title: "Proj", createdAt: nextAt(), updatedAt: nextAt() });
    writeIssue("e", { kind: "epic", title: "Epic", partOf: "p", createdAt: nextAt(), updatedAt: nextAt() });
    writeIssue("a", {
      kind: "story",
      title: "Branch A",
      partOf: "e",
      branchName: "feat/a",
      merged: false,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeFileSync(join(dir, "a", "description.md"), "# Branch A\n\nthe body\n");
    writeFileSync(
      join(dir, "a", "chat.jsonl"),
      JSON.stringify({ role: "agent", name: "bot", body: "first note", at: nextAt() }) + "\n",
    );
  });

  it("prints metadata and description but not the chat by default", () => {
    const { stdout, status } = runCli(["story", "view", "a"]);
    expect(status).toBe(0);
    expect(stdout).toContain("id: a");
    expect(stdout).toContain("kind: story");
    expect(stdout).toContain("title: Branch A");
    expect(stdout).toContain("partOf: e");
    expect(stdout).toContain("mergeBase: main");
    expect(stdout).toContain("branchName: feat/a");
    expect(stdout).toContain("merged: false");
    expect(stdout).toContain("# Branch A");
    expect(stdout).toContain("the body");
    expect(stdout).not.toContain("--- chat ---");
  });

  it("appends the chat log with --chat", () => {
    const { stdout, status } = runCli(["story", "view", "a", "--chat"]);
    expect(status).toBe(0);
    expect(stdout).toContain("--- chat ---");
    expect(stdout).toContain("bot: first note");
  });

  it("errors with a nonzero exit on an unknown id", () => {
    const { stderr, status } = runCli(["story", "view", "ghost"]);
    expect(status).toBe(1);
    expect(stderr).toContain('unknown issue "ghost"');
  });

  it("prints an epic's blockedBy line when it has blockers", () => {
    writeIssue("e2", {
      kind: "epic",
      title: "Epic 2",
      partOf: "p",
      blockedBy: ["e"],
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    const { stdout, status } = runCli(["epic", "view", "e2"]);
    expect(status).toBe(0);
    expect(stdout).toContain("kind: epic");
    expect(stdout).toContain("blockedBy: e");
  });

  it("omits the blockedBy line for an epic with no blockers", () => {
    const { stdout, status } = runCli(["epic", "view", "e"]);
    expect(status).toBe(0);
    expect(stdout).toContain("kind: epic");
    expect(stdout).not.toContain("blockedBy:");
  });

  it("prints workspace when set on a project", () => {
    const ws = makeGitWorkspace();
    try {
      const { status: setStatus } = runCli(["project", "set", "p", "workspace", ws]);
      expect(setStatus).toBe(0);
      const { stdout, status } = runCli(["project", "view", "p"]);
      expect(status).toBe(0);
      expect(stdout).toContain(`workspace: ${ws}`);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it("omits workspace when unset on a project", () => {
    const { stdout, status } = runCli(["project", "view", "p"]);
    expect(status).toBe(0);
    expect(stdout).toContain("mergePolicy: manual");
    expect(stdout).not.toContain("workspace:");
  });
});

describe("project get/set", () => {
  beforeEach(() => {
    writeIssue("p", { kind: "project", title: "Proj", createdAt: nextAt(), updatedAt: nextAt() });
    writeIssue("e", {
      kind: "epic",
      title: "Epic",
      partOf: "p",
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeFileSync(join(dir, "p", "description.md"), "# Proj\n\nbody\n");
  });

  it("gets and sets allowlisted project fields", () => {
    expect(runCli(["project", "get", "p", "title"]).stdout).toBe("Proj\n");
    expect(runCli(["project", "get", "p", "mergePolicy"]).stdout).toBe("manual\n");
    expect(runCli(["project", "get", "p", "description"]).stdout).toBe("# Proj\n\nbody\n");

    expect(runCli(["project", "set", "p", "title", "Renamed"]).status).toBe(0);
    expect(runCli(["project", "get", "p", "title"]).stdout).toBe("Renamed\n");

    expect(runCli(["project", "set", "p", "mergePolicy", "pull-request"]).status).toBe(0);
    expect(runCli(["project", "get", "p", "mergePolicy"]).stdout).toBe("pull-request\n");
  });

  it("sets description from --file and clears workspace with --clear", () => {
    const descFile = join(dir, "desc.md");
    writeFileSync(descFile, "from file\n");
    expect(
      runCli(["project", "set", "p", "description", "--file", descFile]).status,
    ).toBe(0);
    expect(runCli(["project", "get", "p", "description"]).stdout).toBe("from file\n");

    const ws = makeGitWorkspace();
    try {
      expect(runCli(["project", "set", "p", "workspace", ws]).status).toBe(0);
      expect(runCli(["project", "get", "p", "workspace"]).stdout).toBe(`${ws}\n`);
      expect(runCli(["project", "set", "p", "workspace", "--clear"]).status).toBe(0);
      const { stdout, status } = runCli(["project", "get", "p", "workspace"]);
      expect(status).toBe(0);
      expect(stdout).toBe("");
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it("prints empty stdout for unset optional get", () => {
    const { stdout, status } = runCli(["project", "get", "p", "workspace"]);
    expect(status).toBe(0);
    expect(stdout).toBe("");
  });

  it("refuses kind mismatch and unknown fields", () => {
    const mismatch = runCli(["project", "get", "e", "title"]);
    expect(mismatch.status).toBe(1);
    expect(mismatch.stderr).toContain('"e" is an epic, not a project');

    const setMismatch = runCli(["project", "set", "e", "title", "Nope"]);
    expect(setMismatch.status).toBe(1);
    expect(setMismatch.stderr).toContain('"e" is an epic, not a project');

    const unknownGet = runCli(["project", "get", "p", "assignee"]);
    expect(unknownGet.status).toBe(1);
    expect(unknownGet.stderr).toContain('unknown field "assignee" for project');

    const unknownSet = runCli(["project", "set", "p", "assignee", "bot"]);
    expect(unknownSet.status).toBe(1);
    expect(unknownSet.stderr).toContain(
      'unknown or unsettable field "assignee" for project',
    );
  });

  it("wires mergePolicy through to view", () => {
    expect(runCli(["project", "set", "p", "mergePolicy", "pull-request"]).status).toBe(0);
    const { stdout, status } = runCli(["project", "view", "p"]);
    expect(status).toBe(0);
    expect(stdout).toContain("mergePolicy: pull-request");
  });

  it("sets, gets, clears, and surfaces supportingDocs", () => {
    const ws = makeGitWorkspace();
    const visionSrc = join(dir, "vision.md");
    writeFileSync(visionSrc, "# Vision");
    writeFileSync(join(ws, "standards.md"), "# Standards");
    try {
      expect(runCli(["project", "set", "p", "workspace", ws]).status).toBe(0);
      expect(runCli(["project", "attach", "p", visionSrc]).status).toBe(0);

      expect(
        runCli([
          "project",
          "set",
          "p",
          "supportingDocs",
          "--doc",
          "vision",
          "--attachment",
          "vision.md",
        ]).status,
      ).toBe(0);
      expect(
        runCli([
          "project",
          "set",
          "p",
          "supportingDocs",
          "--doc",
          "codingStandards",
          "--workspace",
          "standards.md",
        ]).status,
      ).toBe(0);

      const got = runCli(["project", "get", "p", "supportingDocs"]);
      expect(got.status).toBe(0);
      expect(JSON.parse(got.stdout)).toEqual({
        vision: { type: "attachment", name: "vision.md" },
        codingStandards: { type: "workspace", path: "standards.md" },
      });

      const view = runCli(["project", "view", "p"]);
      expect(view.status).toBe(0);
      expect(view.stdout).toContain(
        "supportingDocs: vision=attachment:vision.md, codingStandards=workspace:standards.md",
      );

      const summary = runCli(["summary", "p"]);
      expect(summary.status).toBe(0);
      expect(summary.stdout).toContain(
        "supportingDocs: vision=attachment:vision.md, codingStandards=workspace:standards.md",
      );

      expect(
        runCli([
          "project",
          "set",
          "p",
          "supportingDocs",
          "--clear",
          "--doc",
          "vision",
        ]).status,
      ).toBe(0);
      expect(JSON.parse(runCli(["project", "get", "p", "supportingDocs"]).stdout)).toEqual({
        codingStandards: { type: "workspace", path: "standards.md" },
      });

      expect(runCli(["project", "set", "p", "supportingDocs", "--clear"]).status).toBe(0);
      expect(runCli(["project", "get", "p", "supportingDocs"]).stdout).toBe("");
      expect(runCli(["project", "view", "p"]).stdout).not.toContain("supportingDocs:");
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it("sets, gets, clears, and surfaces inspirationApps", () => {
    expect(
      runCli([
        "project",
        "set",
        "p",
        "inspirationApps",
        "--add",
        JSON.stringify({
          name: "Notion",
          url: "https://notion.so",
          description: "Note-taking app",
        }),
      ]).status,
    ).toBe(0);
    expect(
      runCli([
        "project",
        "set",
        "p",
        "inspirationApps",
        "--add",
        JSON.stringify({
          name: "Figma",
          url: "https://figma.com",
          description: "Design tool",
        }),
      ]).status,
    ).toBe(0);

    const got = runCli(["project", "get", "p", "inspirationApps"]);
    expect(got.status).toBe(0);
    expect(JSON.parse(got.stdout)).toEqual([
      {
        name: "Notion",
        url: "https://notion.so",
        description: "Note-taking app",
      },
      {
        name: "Figma",
        url: "https://figma.com",
        description: "Design tool",
      },
    ]);

    const line =
      "inspirationApps: Notion — https://notion.so — Note-taking app, Figma — https://figma.com — Design tool";
    expect(runCli(["project", "view", "p"]).stdout).toContain(line);
    expect(runCli(["summary", "p"]).stdout).toContain(line);

    expect(
      runCli(["project", "set", "p", "inspirationApps", "--remove", "Notion"])
        .status,
    ).toBe(0);
    expect(JSON.parse(runCli(["project", "get", "p", "inspirationApps"]).stdout)).toEqual([
      {
        name: "Figma",
        url: "https://figma.com",
        description: "Design tool",
      },
    ]);

    expect(runCli(["project", "set", "p", "inspirationApps", "--clear"]).status).toBe(0);
    expect(JSON.parse(runCli(["project", "get", "p", "inspirationApps"]).stdout)).toEqual([]);
    expect(runCli(["project", "view", "p"]).stdout).not.toContain("inspirationApps:");
  });

  it("refuses inspirationApps on non-project kinds", () => {
    const set = runCli([
      "epic",
      "set",
      "e",
      "inspirationApps",
      "--add",
      JSON.stringify({
        name: "Notion",
        url: "https://notion.so",
        description: "Notes",
      }),
    ]);
    expect(set.status).toBe(1);
    expect(set.stderr).toContain('unknown or unsettable field "inspirationApps" for epic');
  });

  it("refuses invalid supportingDocs sets", () => {
    const ws = makeGitWorkspace();
    try {
      expect(runCli(["project", "set", "p", "workspace", ws]).status).toBe(0);

      const missingAttach = runCli([
        "project",
        "set",
        "p",
        "supportingDocs",
        "--doc",
        "vision",
        "--attachment",
        "vision.md",
      ]);
      expect(missingAttach.status).toBe(1);
      expect(missingAttach.stderr).toContain("not attached");

      const badPath = runCli([
        "project",
        "set",
        "p",
        "supportingDocs",
        "--doc",
        "vision",
        "--workspace",
        "../escape.md",
      ]);
      expect(badPath.status).toBe(1);
      expect(badPath.stderr).toMatch(/\.\.|relative|escape/i);

      const unknownKey = runCli([
        "project",
        "set",
        "p",
        "supportingDocs",
        "--doc",
        "roadmap",
        "--workspace",
        "x.md",
      ]);
      expect(unknownKey.status).toBe(1);
      expect(unknownKey.stderr).toContain("unknown supportingDocs key");

      const missingFile = runCli([
        "project",
        "set",
        "p",
        "supportingDocs",
        "--doc",
        "vision",
        "--workspace",
        "missing.md",
      ]);
      expect(missingFile.status).toBe(1);
      expect(missingFile.stderr).toContain("does not exist");
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
});

describe("idea add / get / set", () => {
  beforeEach(() => {
    writeIssue("p", { kind: "project", title: "Proj", createdAt: nextAt(), updatedAt: nextAt() });
    writeIssue("p2", {
      kind: "project",
      title: "Proj Two",
      order: 1,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeIssue("e", {
      kind: "epic",
      title: "Epic",
      partOf: "p",
      order: 0,
      blockedBy: [],
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
  });

  it("shows --part-of on idea add --help", () => {
    const { stdout, status } = runCli(["idea", "add", "--help"]);
    expect(status).toBe(0);
    expect(stdout).toMatch(/--part-of/);
    expect(stdout).not.toMatch(/--project/);
  });

  it("adds an idea without a description and prints its id", () => {
    const { stdout, status } = runCli(["idea", "add", "--part-of", "p", "Capture me"]);
    expect(status).toBe(0);
    const id = stdout.trim();
    expect(id).toBe("capture-me");
    expect(issueJsonField("capture-me", "kind")).toBe("idea");
    expect(issueJsonField("capture-me", "partOf")).toBe("p");
    expect(issueJsonField("capture-me", "title")).toBe("Capture me");
    expect(readFileSync(join(dir, id, "description.md"), "utf8")).toBe("# Capture me\n");
  });

  it("adds an idea with --description", () => {
    const { stdout, status } = runCli([
      "idea",
      "add",
      "--part-of",
      "p",
      "With body",
      "--description",
      "# Idea\n\nnotes\n",
    ]);
    expect(status).toBe(0);
    const id = stdout.trim();
    expect(id).toBe("with-body");
    expect(readFileSync(join(dir, id, "description.md"), "utf8")).toBe("# Idea\n\nnotes\n");
  });

  it("adds an idea with --file", () => {
    const descFile = join(dir, "idea-desc.md");
    writeFileSync(descFile, "# From file\n\nseeded\n");
    const { stdout, status } = runCli([
      "idea",
      "add",
      "--part-of",
      "p",
      "From file",
      "--file",
      descFile,
    ]);
    expect(status).toBe(0);
    const id = stdout.trim();
    expect(id).toBe("from-file");
    expect(readFileSync(join(dir, id, "description.md"), "utf8")).toBe(
      "# From file\n\nseeded\n",
    );
  });

  it("gets and sets title, archived, partOf, and description", () => {
    expect(runCli(["idea", "add", "--part-of", "p", "Mine later"]).status).toBe(0);
    writeFileSync(join(dir, "mine-later", "description.md"), "# Idea\n\nbody\n");

    expect(runCli(["idea", "get", "mine-later", "title"]).stdout).toBe("Mine later\n");
    expect(runCli(["idea", "get", "mine-later", "partOf"]).stdout).toBe("p\n");
    expect(runCli(["idea", "get", "mine-later", "archived"]).stdout).toBe("false\n");
    expect(runCli(["idea", "get", "mine-later", "description"]).stdout).toBe("# Idea\n\nbody\n");

    expect(runCli(["idea", "set", "mine-later", "title", "Renamed"]).status).toBe(0);
    expect(runCli(["idea", "get", "mine-later", "title"]).stdout).toBe("Renamed\n");

    expect(runCli(["idea", "set", "mine-later", "archived", "true"]).status).toBe(0);
    expect(runCli(["idea", "get", "mine-later", "archived"]).stdout).toBe("true\n");

    expect(runCli(["idea", "set", "mine-later", "partOf", "p2"]).status).toBe(0);
    expect(runCli(["idea", "get", "mine-later", "partOf"]).stdout).toBe("p2\n");

    expect(runCli(["idea", "set", "mine-later", "description", "updated\n"]).status).toBe(0);
    expect(runCli(["idea", "get", "mine-later", "description"]).stdout).toBe("updated\n");
  });

  it("rejects add and set when the parent is not a project", () => {
    const badAdd = runCli(["idea", "add", "--part-of", "e", "Bad parent"]);
    expect(badAdd.status).toBe(1);
    expect(badAdd.stderr).toMatch(/must be a project/);

    expect(runCli(["idea", "add", "--part-of", "p", "Ok"]).status).toBe(0);
    const badSet = runCli(["idea", "set", "ok", "partOf", "e"]);
    expect(badSet.status).toBe(1);
    expect(badSet.stderr).toMatch(/must be a project/);
  });

  it("refuses kind mismatch and unknown fields", () => {
    expect(runCli(["idea", "add", "--part-of", "p", "Mine"]).status).toBe(0);

    const mismatch = runCli(["idea", "get", "e", "title"]);
    expect(mismatch.status).toBe(1);
    expect(mismatch.stderr).toContain('"e" is an epic, not an idea');

    const setMismatch = runCli(["idea", "set", "e", "title", "Nope"]);
    expect(setMismatch.status).toBe(1);
    expect(setMismatch.stderr).toContain('"e" is an epic, not an idea');

    const unknownGet = runCli(["idea", "get", "mine", "assignee"]);
    expect(unknownGet.status).toBe(1);
    expect(unknownGet.stderr).toContain('unknown field "assignee" for idea');

    const unknownSet = runCli(["idea", "set", "mine", "assignee", "bot"]);
    expect(unknownSet.status).toBe(1);
    expect(unknownSet.stderr).toContain(
      'unknown or unsettable field "assignee" for idea',
    );
  });
});

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

  it("adds a project and prints its id", () => {
    const { stdout, status } = runCli(["project", "add", "New Project"]);
    expect(status).toBe(0);
    const id = stdout.trim();
    expect(id).toBe("new-project");
    expect(issueJsonField(id, "kind")).toBe("project");
    expect(issueJsonField(id, "title")).toBe("New Project");
  });

  it.each([
    {
      kind: "task",
      args: ["task", "add", "--part-of", "a", "Child Task", "--assignee", "carol"],
      id: "child-task",
      partOf: "a",
      assignee: "carol",
    },
  ])("adds $kind under the correct parent with assignee", ({ args, id, partOf, assignee }) => {
    const result = runCli(args);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(id);
    expect(issueJsonField(id, "partOf")).toBe(partOf);
    expect(issueJsonField(id, "assignee")).toBe(assignee);
  });

  it.each([
    {
      kind: "epic",
      args: ["epic", "add", "--part-of", "p", "Child Epic", "--assignee", "alice"],
    },
    {
      kind: "story",
      args: ["story", "add", "--part-of", "e", "Child Story", "--assignee", "bob"],
    },
  ])("rejects $kind add with --assignee", ({ args }) => {
    const result = runCli(args);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/unknown option '--assignee'/);
  });

  it("seeds description from --description and --file without --description-file", () => {
    const inline = runCli([
      "project",
      "add",
      "Inline Desc",
      "--description",
      "# Inline\n",
    ]);
    expect(inline.status).toBe(0);
    expect(readFileSync(join(dir, "inline-desc", "description.md"), "utf8")).toBe(
      "# Inline\n",
    );

    const descFile = join(dir, "seed.md");
    writeFileSync(descFile, "# From file\n");
    const fromFile = runCli([
      "epic",
      "add",
      "--part-of",
      "p",
      "File Desc",
      "--file",
      descFile,
    ]);
    expect(fromFile.status).toBe(0);
    expect(readFileSync(join(dir, "file-desc", "description.md"), "utf8")).toBe(
      "# From file\n",
    );

    const help = runCli(["project", "add", "--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toMatch(/--file <path>/);
    expect(help.stdout).not.toMatch(/--description[_-]file/);
  });

  it("stacks a story with --stacked-on", () => {
    const help = runCli(["story", "add", "--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toMatch(/--stacked-on <story>/);
    expect(help.stdout).not.toMatch(/<branch>/);

    const taskHelp = runCli(["task", "add", "--help"]);
    expect(taskHelp.status).toBe(0);
    expect(taskHelp.stdout).toMatch(/--part-of <story>/);
    expect(taskHelp.stdout).not.toMatch(/<branch>/);

    const add = runCli([
      "story",
      "add",
      "Stacked Child",
      "--part-of",
      "e",
      "--stacked-on",
      "a",
    ]);
    expect(add.status).toBe(0);
    expect(add.stdout.trim()).toBe("stacked-child");
    expect(issueJsonField("stacked-child", "stackedOn")).toBe("a");
  });

  it.each([
    {
      kind: "epic",
      args: ["epic", "add", "--part-of", "a", "Nope"],
      error: /must be a project/,
    },
    {
      kind: "story",
      args: ["story", "add", "--part-of", "a", "Nope"],
      error: /must be one of: project, epic/,
    },
    {
      kind: "task",
      args: ["task", "add", "--part-of", "e", "Nope"],
      error: /must be a story/,
    },
  ])("rejects a bad parent for $kind", ({ args, error }) => {
    const result = runCli(args);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(error);
  });

  it("adds a story under a project and reparents between project and epic", () => {
    const add = runCli([
      "story",
      "add",
      "Solo Story",
      "--part-of",
      "p",
    ]);
    expect(add.status).toBe(0);
    expect(add.stdout.trim()).toBe("solo-story");
    expect(issueJsonField("solo-story", "partOf")).toBe("p");

    expect(runCli(["story", "set", "solo-story", "partOf", "e"]).status).toBe(
      0,
    );
    expect(issueJsonField("solo-story", "partOf")).toBe("e");

    expect(runCli(["story", "set", "solo-story", "partOf", "p"]).status).toBe(
      0,
    );
    expect(issueJsonField("solo-story", "partOf")).toBe("p");

    const bad = runCli(["story", "set", "solo-story", "partOf", "a"]);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/must be one of: project, epic/);
  });
});

describe("tree / list / summary include Ideas", () => {
  beforeEach(() => {
    writeIssue("p", { kind: "project", title: "Proj", order: 0, createdAt: nextAt(), updatedAt: nextAt() });
    writeIssue("idea-a", {
      kind: "idea",
      title: "Capture first",
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
    writeIssue("idea-b", {
      kind: "idea",
      title: "Capture last",
      partOf: "p",
      order: 2,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeFileSync(join(dir, "idea-a", "description.md"), "# Idea\n\nfirst capture\n");
  });

  it("interleaves Ideas and Epics by order in tree with title-only Idea rows", () => {
    const { stdout, status } = runCli(["tree", "p"]);
    expect(status).toBe(0);
    expect(stdout).toMatch(/^project p {2}Proj$/m);
    expect(stdout).toMatch(/^ {2}idea idea-a {2}Capture first$/m);
    expect(stdout).toMatch(/^ {2}epic e {2}Epic\b/m);
    expect(stdout).toMatch(/^ {2}idea idea-b {2}Capture last$/m);
    expect(stdout).not.toMatch(/^ {2}idea idea-a .+\[/m);
    const ideaA = stdout.indexOf("idea idea-a");
    const epic = stdout.indexOf("epic e");
    const ideaB = stdout.indexOf("idea idea-b");
    expect(ideaA).toBeLessThan(epic);
    expect(epic).toBeLessThan(ideaB);
  });

  it("interleaves project-level Stories with Epics and Ideas and nests stacked children", () => {
    // beforeEach: idea-a=0, e=1, idea-b=2 — bump idea-b so solo sits between e and idea-b.
    writeIssue("idea-b", {
      kind: "idea",
      title: "Capture last",
      partOf: "p",
      order: 3,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeIssue("solo", {
      kind: "story",
      title: "Solo Story",
      partOf: "p",
      order: 2,
      merged: false,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeIssue("solo-t", {
      kind: "task",
      title: "Solo task",
      partOf: "solo",
      status: "todo",
      order: 0,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeIssue("stacked", {
      kind: "story",
      title: "Stacked Solo",
      partOf: "p",
      stackedOn: "solo",
      order: 0,
      merged: false,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeFileSync(
      join(dir, "solo", "description.md"),
      "# Solo\n\nproject-level story\n",
    );

    const { stdout, status } = runCli(["tree", "p"]);
    expect(status).toBe(0);
    expect(stdout).toMatch(/^ {2}story solo {2}Solo Story\b/m);
    expect(stdout).toMatch(/^ {4}task solo-t {2}Solo task\b/m);
    expect(stdout).toMatch(/^ {4}story stacked {2}Stacked Solo\b/m);
    const ideaA = stdout.indexOf("idea idea-a");
    const epic = stdout.indexOf("epic e");
    const solo = stdout.indexOf("story solo");
    const ideaB = stdout.indexOf("idea idea-b");
    expect(ideaA).toBeLessThan(epic);
    expect(epic).toBeLessThan(solo);
    expect(solo).toBeLessThan(ideaB);

    const summary = runCli(["summary", "solo-t"]);
    expect(summary.status).toBe(0);
    expect(summary.stdout).toContain("Project: p — Proj");
    expect(summary.stdout).toContain("Story: solo — Solo Story");
    expect(summary.stdout).toContain("Task: solo-t — Solo task");
    expect(summary.stdout).not.toContain("Epic:");
  });

  it("includes Ideas in list JSON for the project", () => {
    const { stdout, status } = runCli(["list", "p"]);
    expect(status).toBe(0);
    const listed = JSON.parse(stdout);
    const ids = listed.issues.map((i: { id: string }) => i.id).sort();
    expect(ids).toEqual(["e", "idea-a", "idea-b", "p"]);
    const idea = listed.issues.find((i: { id: string }) => i.id === "idea-a");
    expect(idea.kind).toBe("idea");
  });

  it("summarizes an Idea as Project then Idea", () => {
    const { stdout, status } = runCli(["summary", "idea-a"]);
    expect(status).toBe(0);
    expect(stdout).toContain("Project: p — Proj");
    expect(stdout).toContain("Idea: idea-a — Capture first");
    expect(stdout).toContain("Description: first capture");
    expect(stdout).not.toContain("Epic:");
  });

  it("hides archived Ideas from tree/list unless --show-archived", () => {
    expect(runCli(["idea", "set", "idea-a", "archived", "true"]).status).toBe(0);

    const treeHidden = runCli(["tree", "p"]);
    expect(treeHidden.status).toBe(0);
    expect(treeHidden.stdout).toContain("idea idea-b");
    expect(treeHidden.stdout).not.toContain("idea idea-a");

    const treeShown = runCli(["tree", "p", "--show-archived"]);
    expect(treeShown.status).toBe(0);
    expect(treeShown.stdout).toContain("idea idea-a");

    const listHidden = JSON.parse(runCli(["list", "p"]).stdout);
    expect(listHidden.issues.map((i: { id: string }) => i.id).sort()).toEqual(
      ["e", "idea-b", "p"],
    );

    const listShown = JSON.parse(
      runCli(["list", "p", "--show-archived"]).stdout,
    );
    expect(listShown.issues.map((i: { id: string }) => i.id).sort()).toEqual(
      ["e", "idea-a", "idea-b", "p"],
    );
  });

  it("echoes mixed Idea/Epic order from apply-root", () => {
    // Project-root children: order is the interleaved array index.
    const applyPath = join(dir, "board.yaml");
    writeFileSync(
      applyPath,
      `project:
  id: p
  title: Proj
  children:
    - kind: epic
      id: e
      title: Epic
    - kind: idea
      id: idea-a
      title: Capture first
    - kind: idea
      id: idea-b
      title: Capture last
`,
    );
    const { stdout, status } = runCli(["apply", applyPath]);
    expect(status).toBe(0);
    expect(stdout).toMatch(/^project p {2}Proj$/m);
    expect(stdout).toMatch(/^ {2}epic e {2}Epic\b/m);
    expect(stdout).toMatch(/^ {2}idea idea-a {2}Capture first$/m);
    expect(stdout).toMatch(/^ {2}idea idea-b {2}Capture last$/m);
    const epic = stdout.indexOf("epic e");
    const ideaA = stdout.indexOf("idea idea-a");
    const ideaB = stdout.indexOf("idea idea-b");
    expect(epic).toBeLessThan(ideaA);
    expect(ideaA).toBeLessThan(ideaB);
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

  it("gets and sets allowlisted epic fields", () => {
    expect(runCli(["epic", "get", "e", "title"]).stdout).toBe("Epic\n");
    expect(runCli(["epic", "get", "e", "description"]).stdout).toBe("# Epic\n\nbody\n");
    expect(runCli(["epic", "get", "e", "blockedBy"]).stdout).toBe("[]\n");

    expect(runCli(["epic", "set", "e", "title", "Renamed"]).status).toBe(0);
    expect(runCli(["epic", "get", "e", "title"]).stdout).toBe("Renamed\n");

    const unknownAssigneeGet = runCli(["epic", "get", "e", "assignee"]);
    expect(unknownAssigneeGet.status).toBe(1);
    expect(unknownAssigneeGet.stderr).toContain('unknown field "assignee" for epic');
    const unknownAssigneeSet = runCli(["epic", "set", "e", "assignee", "bot"]);
    expect(unknownAssigneeSet.status).toBe(1);
    expect(unknownAssigneeSet.stderr).toContain(
      'unknown or unsettable field "assignee" for epic',
    );

    expect(
      runCli(["epic", "set", "e", "needsAttention", "true", "--reason", "need decision"]).status,
    ).toBe(0);
    expect(runCli(["epic", "get", "e", "needsAttention"]).stdout).toBe("true\n");
    expect(runCli(["epic", "get", "e", "attentionReason"]).stdout).toBe("need decision\n");
    expect(runCli(["epic", "set", "e", "needsAttention", "false"]).status).toBe(0);
    expect(runCli(["epic", "get", "e", "needsAttention"]).stdout).toBe("false\n");
    expect(runCli(["epic", "get", "e", "attentionReason"]).stdout).toBe("");

    expect(runCli(["epic", "set", "e", "retro", "in-progress"]).status).toBe(0);
    expect(runCli(["epic", "get", "e", "retro"]).stdout).toBe("in-progress\n");
    expect(runCli(["epic", "set", "e", "retro", "done"]).status).toBe(0);
    expect(runCli(["epic", "get", "e", "retro"]).stdout).toBe("done\n");
    expect(runCli(["epic", "set", "e", "retro", "--clear"]).status).toBe(0);
    expect(runCli(["epic", "get", "e", "retro"]).stdout).toBe("");

    const invalidRetro = runCli(["epic", "set", "e", "retro", "pending"]);
    expect(invalidRetro.status).toBe(1);
    expect(invalidRetro.stderr).toMatch(/invalid retro "pending"/);
  });

  it("replaces and incrementally edits blockedBy", () => {
    expect(
      runCli(["epic", "set", "e", "blockedBy", '["blocker"]']).status,
    ).toBe(0);
    expect(blockedByOf("e")).toEqual(["blocker"]);
    expect(runCli(["epic", "get", "e", "blockedBy"]).stdout).toBe('["blocker"]\n');

    expect(runCli(["epic", "set", "e", "blockedBy", "--add", "other"]).status).toBe(0);
    expect(blockedByOf("e").sort()).toEqual(["blocker", "other"]);

    // --add is idempotent for ids already present.
    expect(runCli(["epic", "set", "e", "blockedBy", "--add", "blocker", "other"]).status).toBe(
      0,
    );
    expect(blockedByOf("e").sort()).toEqual(["blocker", "other"]);

    expect(runCli(["epic", "set", "e", "blockedBy", "--remove", "blocker"]).status).toBe(0);
    expect(blockedByOf("e")).toEqual(["other"]);

    expect(runCli(["epic", "set", "e", "blockedBy", "--clear"]).status).toBe(0);
    expect(blockedByOf("e")).toEqual([]);
    expect(runCli(["epic", "get", "e", "blockedBy"]).stdout).toBe("[]\n");
  });

  it("rejects invalid blockedBy set modes and wrong kind", () => {
    expect(runCli(["epic", "set", "e", "blockedBy", '["blocker"]']).status).toBe(0);

    const combined = runCli([
      "epic",
      "set",
      "e",
      "blockedBy",
      '["other"]',
      "--add",
      "blocker",
    ]);
    expect(combined.status).toBe(1);
    expect(combined.stderr).toMatch(/mutually exclusive/);
    expect(blockedByOf("e")).toEqual(["blocker"]);

    const missing = runCli(["epic", "set", "e", "blockedBy"]);
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
    const wrongKind = runCli(["epic", "set", "br", "blockedBy", "--add", "blocker"]);
    expect(wrongKind.status).toBe(1);
    expect(wrongKind.stderr).toMatch(/"br" is a story, not an epic/);
  });

  it("gets derived epicStatus and blocked", () => {
    expect(runCli(["epic", "get", "e", "epicStatus"]).stdout).toBe("todo\n");
    expect(runCli(["epic", "get", "e", "blocked"]).stdout).toBe("false\n");

    expect(runCli(["epic", "set", "e", "blockedBy", '["blocker"]']).status).toBe(0);
    expect(runCli(["epic", "get", "e", "blocked"]).stdout).toBe("true\n");

    writeIssue("br", {
      kind: "story",
      title: "Branch",
      partOf: "e",
      merged: false,
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    expect(runCli(["epic", "get", "e", "epicStatus"]).stdout).toBe("todo\n");

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
    expect(runCli(["epic", "get", "e", "epicStatus"]).stdout).toBe("in-progress\n");
  });

  it("preserves retro across apply", () => {
    expect(runCli(["epic", "set", "e", "retro", "in-progress"]).status).toBe(0);

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
    expect(runCli(["apply", applyPath]).status).toBe(0);
    const onDisk = JSON.parse(readFileSync(join(dir, "e", "issue.json"), "utf8"));
    expect(onDisk.retro).toBe("in-progress");
    expect(onDisk.title).toBe("Epic renamed");
  });

  it("refuses kind mismatch and unknown fields", () => {
    const mismatch = runCli(["epic", "get", "p", "title"]);
    expect(mismatch.status).toBe(1);
    expect(mismatch.stderr).toContain('"p" is a project, not an epic');

    const unknownGet = runCli(["epic", "get", "e", "workspace"]);
    expect(unknownGet.status).toBe(1);
    expect(unknownGet.stderr).toContain('unknown field "workspace" for epic');

    const removedReady = runCli(["epic", "get", "e", "ready"]);
    expect(removedReady.status).toBe(1);
    expect(removedReady.stderr).toContain('unknown field "ready" for epic');

    const unknownSet = runCli(["epic", "set", "e", "workspace", "/tmp"]);
    expect(unknownSet.status).toBe(1);
    expect(unknownSet.stderr).toContain(
      'unknown or unsettable field "workspace" for epic',
    );
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

  it("gets and sets allowlisted branch fields", () => {
    expect(runCli(["story", "get", "a", "title"]).stdout).toBe("Branch A\n");
    expect(runCli(["story", "get", "a", "description"]).stdout).toBe("# Branch\n\nbody\n");
    expect(runCli(["story", "get", "a", "merged"]).stdout).toBe("false\n");
    expect(runCli(["story", "get", "b", "stackedOn"]).stdout).toBe("a\n");

    expect(runCli(["story", "set", "a", "title", "Renamed"]).status).toBe(0);
    expect(runCli(["story", "get", "a", "title"]).stdout).toBe("Renamed\n");

    expect(runCli(["story", "set", "a", "branchName", "feat/a"]).status).toBe(0);
    expect(runCli(["story", "get", "a", "branchName"]).stdout).toBe("feat/a\n");

    expect(runCli(["story", "set", "b", "stackedOn", "--clear"]).status).toBe(0);
    expect(runCli(["story", "get", "b", "stackedOn"]).stdout).toBe("");
    expect(runCli(["story", "set", "b", "stackedOn", "a"]).status).toBe(0);
    expect(runCli(["story", "get", "b", "stackedOn"]).stdout).toBe("a\n");

    expect(runCli(["story", "set", "a", "prUrl", "https://pr/1"]).status).toBe(0);
    expect(runCli(["story", "get", "a", "prUrl"]).stdout).toBe("https://pr/1\n");
    expect(runCli(["story", "set", "a", "prUrl", "--clear"]).status).toBe(0);
    expect(runCli(["story", "get", "a", "prUrl"]).stdout).toBe("");

    expect(runCli(["story", "set", "a", "specReview", "passed"]).status).toBe(0);
    expect(runCli(["story", "get", "a", "specReview"]).stdout).toBe("passed\n");

    expect(runCli(["story", "set", "a", "retro", "in-progress"]).status).toBe(0);
    expect(runCli(["story", "get", "a", "retro"]).stdout).toBe("in-progress\n");
    expect(runCli(["story", "set", "a", "retro", "done"]).status).toBe(0);
    expect(runCli(["story", "get", "a", "retro"]).stdout).toBe("done\n");
    expect(runCli(["story", "set", "a", "retro", "--clear"]).status).toBe(0);
    expect(runCli(["story", "get", "a", "retro"]).stdout).toBe("");

    const invalidRetro = runCli(["story", "set", "a", "retro", "pending"]);
    expect(invalidRetro.status).toBe(1);
    expect(invalidRetro.stderr).toMatch(/invalid retro "pending"/);

    const unknownAssigneeGet = runCli(["story", "get", "a", "assignee"]);
    expect(unknownAssigneeGet.status).toBe(1);
    expect(unknownAssigneeGet.stderr).toContain('unknown field "assignee" for story');
    const unknownAssigneeSet = runCli(["story", "set", "a", "assignee", "bot"]);
    expect(unknownAssigneeSet.status).toBe(1);
    expect(unknownAssigneeSet.stderr).toContain(
      'unknown or unsettable field "assignee" for story',
    );

    expect(
      runCli(["story", "set", "a", "needsAttention", "true", "--reason", "blocked"]).status,
    ).toBe(0);
    expect(runCli(["story", "get", "a", "needsAttention"]).stdout).toBe("true\n");
    expect(runCli(["story", "get", "a", "attentionReason"]).stdout).toBe("blocked\n");
    expect(runCli(["story", "set", "a", "needsAttention", "false"]).status).toBe(0);
    expect(runCli(["story", "get", "a", "needsAttention"]).stdout).toBe("false\n");
    expect(runCli(["story", "get", "a", "attentionReason"]).stdout).toBe("");
  });

  it("gets derived storyStatus, mergeBase, and blocked", () => {
    expect(runCli(["story", "get", "a", "storyStatus"]).stdout).toBe("not-started\n");
    expect(runCli(["story", "get", "a", "mergeBase"]).stdout).toBe("main\n");
    expect(runCli(["story", "get", "a", "blocked"]).stdout).toBe("false\n");

    expect(runCli(["story", "get", "b", "blocked"]).stdout).toBe("true\n");
    // b is stacked on unnamed a — derived mergeBase unset.
    expect(runCli(["story", "get", "b", "mergeBase"]).stdout).toBe("");

    const add = runCli([
      "story",
      "add",
      "Unset child",
      "--part-of",
      "e",
      "--stacked-on",
      "a",
    ]);
    expect(add.status).toBe(0);
    const childId = add.stdout.trim();
    expect(runCli(["story", "get", childId, "mergeBase"]).stdout).toBe("");

    expect(runCli(["story", "set", "a", "branchName", "feat/a"]).status).toBe(0);
    expect(runCli(["story", "get", "a", "storyStatus"]).stdout).toBe("in-progress\n");
    expect(runCli(["story", "get", "b", "blocked"]).stdout).toBe("false\n");
    expect(runCli(["story", "get", "b", "mergeBase"]).stdout).toBe("feat/a\n");
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
    expect(runCli(["story", "set", "a", "prUrl", "https://pr/1"]).status).toBe(0);
    expect(runCli(["story", "get", "a", "storyStatus"]).stdout).toBe("pr-open\n");
  });

  it("does not cascade mergeBase on disk when parent is merged", () => {
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

    expect(runCli(["story", "set", "a", "merged", "true"]).status).toBe(0);
    expect(mergeBaseOf("b")).toBeUndefined();
    expect(runCli(["story", "get", "b", "mergeBase"]).stdout).toBe("main\n");
    expect(runCli(["story", "get", "a", "merged"]).stdout).toBe("true\n");
  });

  it("refuses kind mismatch, unknown fields, and unsettable mergeBase", () => {
    const mismatch = runCli(["story", "get", "e", "title"]);
    expect(mismatch.status).toBe(1);
    expect(mismatch.stderr).toContain('"e" is an epic, not a story');

    const unknownGet = runCli(["story", "get", "a", "blockedBy"]);
    expect(unknownGet.status).toBe(1);
    expect(unknownGet.stderr).toContain('unknown field "blockedBy" for story');

    const removedBase = runCli(["story", "get", "a", "base"]);
    expect(removedBase.status).toBe(1);
    expect(removedBase.stderr).toContain('unknown field "base" for story');

    const removedReady = runCli(["story", "get", "a", "ready"]);
    expect(removedReady.status).toBe(1);
    expect(removedReady.stderr).toContain('unknown field "ready" for story');

    const unknownSet = runCli(["story", "set", "a", "mergeBase", "main"]);
    expect(unknownSet.status).toBe(1);
    expect(unknownSet.stderr).toContain(
      'unknown or unsettable field "mergeBase" for story',
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
    const setOnCommit = runCli(["story", "set", "c1", "specReview", "passed"]);
    expect(setOnCommit.status).toBe(1);
    expect(setOnCommit.stderr).toMatch(/"c1" is a task, not a story/);
  });

  it("surfaces specReview in view/list and preserves it across apply", () => {
    expect(runCli(["story", "view", "a"]).stdout).not.toContain("specReview:");

    expect(runCli(["story", "set", "a", "specReview", "passed"]).status).toBe(0);
    expect(runCli(["story", "view", "a"]).stdout).toContain("specReview: passed");

    const listed = JSON.parse(runCli(["list", "p"]).stdout);
    const branch = listed.issues.find((i: { id: string }) => i.id === "a");
    expect(branch.specReview).toBe("passed");

    const invalid = runCli(["story", "set", "a", "specReview", "pending"]);
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toMatch(/invalid specReview "pending"/);

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
    expect(runCli(["story", "set", "a", "specReview", "failed"]).status).toBe(0);
    expect(runCli(["apply", applyPath]).status).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "a", "issue.json"), "utf8")).specReview).toBe(
      "failed",
    );
    expect(runCli(["story", "view", "a"]).stdout).toContain("specReview: failed");
    expect(runCli(["story", "view", "a"]).stdout).toContain("title: Branch A renamed");
  });

  it("preserves retro across apply", () => {
    expect(runCli(["story", "set", "a", "retro", "in-progress"]).status).toBe(0);

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
    expect(runCli(["apply", applyPath]).status).toBe(0);
    const onDisk = JSON.parse(readFileSync(join(dir, "a", "issue.json"), "utf8"));
    expect(onDisk.retro).toBe("in-progress");
    expect(onDisk.title).toBe("Branch A renamed");
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

  it("gets and sets allowlisted commit fields", () => {
    expect(runCli(["task", "get", "c1", "title"]).stdout).toBe("Commit 1\n");
    expect(runCli(["task", "get", "c1", "description"]).stdout).toBe("# Commit\n\nbody\n");
    expect(runCli(["task", "get", "c1", "status"]).stdout).toBe("todo\n");
    expect(runCli(["task", "get", "c1", "noDiff"]).stdout).toBe("");

    expect(runCli(["task", "set", "c1", "title", "Renamed"]).status).toBe(0);
    expect(runCli(["task", "get", "c1", "title"]).stdout).toBe("Renamed\n");

    expect(runCli(["task", "set", "c1", "status", "in-progress"]).status).toBe(0);
    expect(runCli(["task", "get", "c1", "status"]).stdout).toBe("in-progress\n");

    expect(runCli(["task", "set", "c1", "status", "fixing"]).status).toBe(0);
    expect(runCli(["task", "get", "c1", "status"]).stdout).toBe("fixing\n");

    expect(runCli(["task", "set", "c1", "qa", "reviewing"]).status).toBe(0);
    expect(runCli(["task", "get", "c1", "qa"]).stdout).toBe("reviewing\n");
    expect(runCli(["task", "set", "c1", "qa", "--clear"]).status).toBe(0);
    expect(runCli(["task", "get", "c1", "qa"]).stdout).toBe("");

    const invalidQa = runCli(["task", "set", "c1", "qa", "pending"]);
    expect(invalidQa.status).toBe(1);
    expect(invalidQa.stderr).toMatch(/invalid qa "pending"/);

    expect(runCli(["task", "set", "c1", "commitSha", sha1]).status).toBe(0);
    expect(runCli(["task", "get", "c1", "commitSha"]).stdout).toBe(`${sha1}\n`);
    expect(runCli(["task", "set", "c1", "commitSha", "--clear"]).status).toBe(0);
    expect(runCli(["task", "get", "c1", "commitSha"]).stdout).toBe("");

    expect(runCli(["task", "set", "c1", "noDiff", "true"]).status).toBe(0);
    expect(runCli(["task", "get", "c1", "noDiff"]).stdout).toBe("true\n");
    expect(runCli(["task", "set", "c1", "noDiff", "false"]).status).toBe(0);
    expect(runCli(["task", "get", "c1", "noDiff"]).stdout).toBe("");

    expect(runCli(["task", "set", "c1", "assignee", "bot"]).status).toBe(0);
    expect(runCli(["task", "get", "c1", "assignee"]).stdout).toBe("bot\n");
    expect(runCli(["task", "set", "c1", "assignee", "--clear"]).status).toBe(0);
    expect(runCli(["task", "get", "c1", "assignee"]).stdout).toBe("");

    expect(
      runCli(["task", "set", "c1", "needsAttention", "true", "--reason", "blocked"]).status,
    ).toBe(0);
    expect(runCli(["task", "get", "c1", "needsAttention"]).stdout).toBe("true\n");
    expect(runCli(["task", "get", "c1", "attentionReason"]).stdout).toBe("blocked\n");
    expect(runCli(["task", "set", "c1", "needsAttention", "false"]).status).toBe(0);
    expect(runCli(["task", "get", "c1", "needsAttention"]).stdout).toBe("false\n");
    expect(runCli(["task", "get", "c1", "attentionReason"]).stdout).toBe("");
  });

  it("sets description from --file", () => {
    const descFile = join(dir, "desc.md");
    writeFileSync(descFile, "from file\n");
    expect(
      runCli(["task", "set", "c1", "description", "--file", descFile]).status,
    ).toBe(0);
    expect(runCli(["task", "get", "c1", "description"]).stdout).toBe("from file\n");
  });

  it("gets derived blocked", () => {
    expect(runCli(["task", "get", "c1", "blocked"]).stdout).toBe("false\n");
    expect(runCli(["task", "get", "c2", "blocked"]).stdout).toBe("true\n");

    expect(runCli(["task", "set", "c1", "status", "done"]).status).toBe(0);
    expect(runCli(["task", "get", "c1", "blocked"]).stdout).toBe("false\n");
    expect(runCli(["task", "get", "c2", "blocked"]).stdout).toBe("false\n");
  });

  it("refuses kind mismatch, unknown fields, and invalid commitSha / noDiff", () => {
    const mismatch = runCli(["task", "get", "a", "title"]);
    expect(mismatch.status).toBe(1);
    expect(mismatch.stderr).toContain('"a" is a story, not a task');

    const unknownGet = runCli(["task", "get", "c1", "branchName"]);
    expect(unknownGet.status).toBe(1);
    expect(unknownGet.stderr).toContain('unknown field "branchName" for task');

    const removedReady = runCli(["task", "get", "c1", "ready"]);
    expect(removedReady.status).toBe(1);
    expect(removedReady.stderr).toContain('unknown field "ready" for task');

    const unknownSet = runCli(["task", "set", "c1", "branchName", "feat/x"]);
    expect(unknownSet.status).toBe(1);
    expect(unknownSet.stderr).toContain(
      'unknown or unsettable field "branchName" for task',
    );

    const badSha = runCli(["task", "set", "c1", "commitSha", "4019c25"]);
    expect(badSha.status).toBe(1);
    expect(badSha.stderr).toMatch(/invalid commit sha "4019c25"/);

    const shortSha = runCli([
      "task",
      "set",
      "c1",
      "commitSha",
      "0123456789abcdef0123456789abcdef0123456",
    ]);
    expect(shortSha.status).toBe(1);
    expect(shortSha.stderr).toMatch(/invalid commit sha/);

    const nonHex = runCli([
      "task",
      "set",
      "c1",
      "commitSha",
      "ghijghijghijghijghijghijghijghijghijghij",
    ]);
    expect(nonHex.status).toBe(1);
    expect(nonHex.stderr).toMatch(/invalid commit sha/);

    const upper = runCli([
      "task",
      "set",
      "c1",
      "commitSha",
      "0123456789ABCDEF0123456789ABCDEF01234567",
    ]);
    expect(upper.status).toBe(1);
    expect(upper.stderr).toMatch(/invalid commit sha/);

    expect(runCli(["task", "set", "a", "commitSha", sha1]).stderr).toMatch(
      /"a" is a story, not a task/,
    );
    expect(runCli(["task", "set", "a", "noDiff", "true"]).stderr).toMatch(
      /"a" is a story, not a task/,
    );

    const badNoDiff = runCli(["task", "set", "c1", "noDiff", "maybe"]);
    expect(badNoDiff.status).toBe(1);
    expect(badNoDiff.stderr).toMatch(/invalid noDiff "maybe"/);
  });

  it("surfaces qa in view/tree and preserves it across apply", () => {
    expect(runCli(["task", "view", "c1"]).stdout).not.toContain("qa:");

    expect(runCli(["task", "set", "c1", "status", "fixing"]).status).toBe(0);
    expect(runCli(["task", "set", "c1", "qa", "passed"]).status).toBe(0);
    expect(runCli(["task", "view", "c1"]).stdout).toContain("status: fixing");
    expect(runCli(["task", "view", "c1"]).stdout).toContain("qa: passed");
    expect(runCli(["tree", "p"]).stdout).toMatch(/^ {6}task c1\b.*\bqa=passed/m);

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
    expect(runCli(["apply", applyPath]).status).toBe(0);
    const onDisk = JSON.parse(readFileSync(join(dir, "c1", "issue.json"), "utf8"));
    expect(onDisk.status).toBe("fixing");
    expect(onDisk.qa).toBe("passed");
    expect(runCli(["task", "view", "c1"]).stdout).toContain("qa: passed");
    expect(runCli(["task", "view", "c1"]).stdout).toContain("title: Commit 1 renamed");

    expect(runCli(["task", "set", "c1", "qa", "--clear"]).status).toBe(0);
    expect(runCli(["tree", "p"]).stdout).not.toMatch(/^ {6}task c1\b.*\bqa=/m);
  });

  it("accepts sha256 commitSha and surfaces noDiff in view/summary", () => {
    expect(runCli(["task", "set", "c1", "commitSha", sha256]).status).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "c1", "issue.json"), "utf8")).commitSha).toBe(
      sha256,
    );

    expect(runCli(["task", "view", "c1"]).stdout).not.toContain("noDiff:");
    expect(runCli(["task", "set", "c1", "noDiff", "true"]).status).toBe(0);
    expect(runCli(["task", "view", "c1"]).stdout).toContain("noDiff: true");
    expect(runCli(["summary", "c1"]).stdout).toContain("noDiff: true");

    expect(runCli(["task", "set", "c1", "noDiff", "false"]).status).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "c1", "issue.json"), "utf8"))).not.toHaveProperty(
      "noDiff",
    );
    expect(runCli(["task", "view", "c1"]).stdout).not.toContain("noDiff:");
  });

  it("gets whitespace assignee as stored and errors on unknown id", () => {
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
    expect(runCli(["task", "get", "c1", "assignee"]).stdout).toBe("   \n");

    const unknown = runCli(["task", "get", "ghost", "assignee"]);
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain('unknown issue "ghost"');
  });

  it("reparents via partOf and rejects bad parents", () => {
    expect(runCli(["task", "set", "c1", "partOf", "a2"]).status).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "c1", "issue.json"), "utf8")).partOf).toBe("a2");

    const wrongKind = runCli(["task", "set", "c1", "partOf", "e"]);
    expect(wrongKind.status).toBe(1);
    expect(wrongKind.stderr).toMatch(/must be a story, not a epic/);
    expect(JSON.parse(readFileSync(join(dir, "c1", "issue.json"), "utf8")).partOf).toBe("a2");

    const unknown = runCli(["task", "set", "c1", "partOf", "ghost"]);
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toMatch(/references unknown issue "ghost"/);
  });
});

describe("tree", () => {
  beforeEach(() => {
    writeIssue("p", { kind: "project", title: "Proj", createdAt: nextAt(), updatedAt: nextAt() });
    writeIssue("e", { kind: "epic", title: "Epic", partOf: "p", createdAt: nextAt(), updatedAt: nextAt() });
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
    writeIssue("b", {
      kind: "story",
      title: "Branch B",
      partOf: "e",
      stackedOn: "a",
      merged: false,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
  });

  it("renders indentation, chips, and stacked depth-first order", () => {
    const { stdout, status } = runCli(["tree", "p"]);
    expect(status).toBe(0);
    // Indentation: project at col 0, epic +2, root branch +4, commit +6.
    expect(stdout).toMatch(/^project p {2}Proj$/m);
    expect(stdout).toMatch(/^ {2}epic e {2}Epic\b/m);
    // Root branch at +4 with a chip tail. Assert the line shape and each
    // expected chip independently rather than pinning the exact chip set/order,
    // so adding or reordering a chip doesn't break this indentation test.
    expect(stdout).toMatch(/^ {4}story a {2}Branch A {2}\[.*\]$/m);
    expect(stdout).toMatch(/^ {4}story a\b.*\bstatus=not-started\b/m);
    expect(stdout).toMatch(/^ {4}story a\b.*\bmergeBase=main\b/m);
    expect(stdout).toMatch(/^ {4}story a\b.*\bbranch=\(unset\)/m);
    expect(stdout).toMatch(/^ {6}task c1 {2}C1 {2}\[status=todo\b.*\]$/m);
    // A story stacked on a root sits one level deeper (+6, same as its
    // sibling task). Parent a is unnamed → derived mergeBase=(unset).
    expect(stdout).toMatch(/^ {6}story b {2}Branch B {2}\[.*mergeBase=\(unset\).*\]$/m);

    // Depth-first: the root story and its task precede the stacked story.
    expect(stdout.indexOf("story a")).toBeLessThan(stdout.indexOf("task c1"));
    expect(stdout.indexOf("task c1")).toBeLessThan(stdout.indexOf("story b"));
  });

  it("shows mergeBase=(unset) for a stacked child whose mergeBase is not set yet", () => {
    // Create via the CLI: child of an unnamed parent leaves derived mergeBase
    // unset until the parent gets a branchName.
    const add = runCli([
      "story",
      "add",
      "Unset child",
      "--part-of",
      "e",
      "--stacked-on",
      "a",
    ]);
    expect(add.status).toBe(0);
    const childId = add.stdout.trim();
    const { stdout, status } = runCli(["tree", "p"]);
    expect(status).toBe(0);
    expect(stdout).toMatch(
      new RegExp(`^\\s+story ${childId}\\b.*\\bmergeBase=\\(unset\\)`, "m"),
    );
  });

  it("scopes by a positional project id", () => {
    const { stdout, status } = runCli(["tree", "p"]);
    expect(status).toBe(0);
    expect(stdout).toMatch(/^project p {2}Proj$/m);
    expect(stdout).toContain("epic e");
  });

  it("scopes by a positional epic id", () => {
    const { stdout, status } = runCli(["tree", "e"]);
    expect(status).toBe(0);
    expect(stdout).toMatch(/^epic e {2}Epic\b/m);
    expect(stdout).toContain("story a");
    expect(stdout).not.toContain("project p");
  });

  it("scopes by a positional story id to that story and its tasks only", () => {
    const { stdout, status } = runCli(["tree", "a"]);
    expect(status).toBe(0);
    expect(stdout).toMatch(/^story a {2}Branch A\b/m);
    expect(stdout).toMatch(/^ {2}task c1 {2}C1\b/m);
    expect(stdout).not.toContain("story b");
    expect(stdout).not.toContain("epic e");
  });

  it("refuses a positional task id and names the parent story", () => {
    const { stderr, status } = runCli(["tree", "c1"]);
    expect(status).toBe(1);
    expect(stderr).toContain("cannot scope tree to a task");
    expect(stderr).toContain('story "a"');
  });

  it("refuses an unknown positional id", () => {
    const { stderr, status } = runCli(["tree", "ghost"]);
    expect(status).toBe(1);
    expect(stderr).toContain('unknown issue "ghost"');
  });

  it("refuses title lookup and dropped scope flags", () => {
    const byTitle = runCli(["tree", "Proj"]);
    expect(byTitle.status).toBe(1);
    expect(byTitle.stderr).toContain('unknown issue "Proj"');

    const withProject = runCli(["tree", "--project", "p"]);
    expect(withProject.status).not.toBe(0);
    expect(withProject.stderr).toMatch(/unknown option '--project'/);

    const withEpic = runCli(["tree", "--epic", "e"]);
    expect(withEpic.status).not.toBe(0);
    expect(withEpic.stderr).toMatch(/unknown option '--epic'/);
  });

  it("lists the same project/epic/story scopes as tree and omits for all", () => {
    const projectList = JSON.parse(runCli(["list", "p"]).stdout);
    expect(projectList.issues.map((i: { id: string }) => i.id).sort()).toEqual(
      ["a", "b", "c1", "e", "p"],
    );

    const epicList = JSON.parse(runCli(["list", "e"]).stdout);
    expect(epicList.issues.map((i: { id: string }) => i.id).sort()).toEqual(
      ["a", "b", "c1", "e"],
    );

    const storyList = JSON.parse(runCli(["list", "a"]).stdout);
    expect(storyList.issues.map((i: { id: string }) => i.id).sort()).toEqual(
      ["a", "c1"],
    );

    const all = JSON.parse(runCli(["list"]).stdout);
    expect(all.issues.map((i: { id: string }) => i.id).sort()).toEqual(
      ["a", "b", "c1", "e", "p"],
    );

    const taskList = runCli(["list", "c1"]);
    expect(taskList.status).toBe(1);
    expect(taskList.stderr).toContain("cannot scope list to a task");
  });

  it("shows specReview and retro chips on the correct lines only when set", () => {
    const unset = runCli(["tree", "p"]);
    expect(unset.status).toBe(0);
    expect(unset.stdout).not.toMatch(/^ {2}epic e\b.*\bretro=/m);
    expect(unset.stdout).not.toMatch(/^ {4}story a\b.*\bspecReview=/m);
    expect(unset.stdout).not.toMatch(/^ {4}story a\b.*\bretro=/m);

    expect(runCli(["epic", "set", "e", "retro", "in-progress"]).status).toBe(0);
    expect(runCli(["story", "set", "a", "specReview", "passed"]).status).toBe(0);
    expect(runCli(["story", "set", "a", "retro", "done"]).status).toBe(0);

    const set = runCli(["tree", "p"]);
    expect(set.status).toBe(0);
    expect(set.stdout).toMatch(/^ {2}epic e\b.*\bretro=in-progress\b/m);
    expect(set.stdout).toMatch(/^ {4}story a\b.*\bspecReview=passed\b/m);
    expect(set.stdout).toMatch(/^ {4}story a\b.*\bretro=done\b/m);

    expect(runCli(["epic", "set", "e", "retro", "--clear"]).status).toBe(0);
    expect(runCli(["story", "set", "a", "retro", "--clear"]).status).toBe(0);

    const cleared = runCli(["tree", "p"]);
    expect(cleared.status).toBe(0);
    expect(cleared.stdout).not.toMatch(/^ {2}epic e\b.*\bretro=/m);
    expect(cleared.stdout).not.toMatch(/^ {4}story a\b.*\bretro=/m);
    expect(cleared.stdout).toMatch(/^ {4}story a\b.*\bspecReview=passed\b/m);
  });
});

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

  it("gets/sets archived on epic and cascades to descendants", () => {
    expect(runCli(["epic", "get", "e", "archived"]).stdout).toBe("false\n");
    expect(runCli(["epic", "set", "e", "archived", "true"]).status).toBe(0);
    expect(runCli(["epic", "get", "e", "archived"]).stdout).toBe("true\n");
    expect(runCli(["story", "get", "a", "archived"]).stdout).toBe("true\n");
    expect(runCli(["task", "get", "c1", "archived"]).stdout).toBe("true\n");

    expect(runCli(["epic", "set", "e", "archived", "false"]).status).toBe(0);
    expect(runCli(["story", "get", "a", "archived"]).stdout).toBe("false\n");
    expect(runCli(["task", "get", "c1", "archived"]).stdout).toBe("false\n");
  });

  it("hides archived issues from tree/list unless --show-archived", () => {
    expect(runCli(["epic", "set", "e", "archived", "true"]).status).toBe(0);

    const treeHidden = runCli(["tree", "p"]);
    expect(treeHidden.status).toBe(0);
    expect(treeHidden.stdout).toContain("project p");
    expect(treeHidden.stdout).not.toContain("epic e");
    expect(treeHidden.stdout).not.toContain("story a");

    const treeShown = runCli(["tree", "p", "--show-archived"]);
    expect(treeShown.status).toBe(0);
    expect(treeShown.stdout).toContain("epic e");
    expect(treeShown.stdout).toContain("story a");

    const listHidden = runCli(["list", "p"]);
    expect(listHidden.status).toBe(0);
    const hiddenIds = JSON.parse(listHidden.stdout).issues.map(
      (issue: { id: string }) => issue.id,
    );
    expect(hiddenIds).toEqual(["p"]);

    const listShown = runCli(["list", "p", "--show-archived"]);
    expect(listShown.status).toBe(0);
    const shownIds = JSON.parse(listShown.stdout).issues.map(
      (issue: { id: string }) => issue.id,
    );
    expect(shownIds.sort()).toEqual(["a", "c1", "e", "p"]);
  });

  it("creates a child under an archived parent as archived", () => {
    expect(runCli(["epic", "set", "e", "archived", "true"]).status).toBe(0);
    const add = runCli(["story", "add", "Child", "--part-of", "e"]);
    expect(add.status).toBe(0);
    const childId = add.stdout.trim();
    expect(runCli(["story", "get", childId, "archived"]).stdout).toBe("true\n");
  });

  it("refuses project set archived", () => {
    const result = runCli(["project", "set", "p", "archived", "true"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/unknown or unsettable field "archived"/);
  });
});

describe("deleted field verbs", () => {
  it("are unknown commands and absent from top-level --help", () => {
    const help = runCli(["--help"]);
    expect(help.status).toBe(0);

    for (const verb of DELETED_FIELD_VERBS) {
      const { stderr, status } = runCli([verb]);
      expect(status, verb).not.toBe(0);
      expect(stderr, verb).toMatch(new RegExp(`unknown command '${verb}'`));
      expect(help.stdout, verb).not.toMatch(new RegExp(`\\n  ${verb}\\b`));
    }
  });
});

describe("legacy CLI removed", () => {
  const LEGACY_COMMANDS = [
    "create-project",
    "create-epic",
    "add-story",
    "add-task",
    "show",
    "delete",
    "comment",
    "attach",
    "attachments",
    "detach",
    "projects",
  ];

  it("are unknown commands and absent from top-level --help", () => {
    const help = runCli(["--help"]);
    expect(help.status).toBe(0);

    for (const verb of LEGACY_COMMANDS) {
      const { stderr, status } = runCli([verb]);
      expect(status, verb).not.toBe(0);
      expect(stderr, verb).toMatch(new RegExp(`unknown command '${verb}'`));
      expect(help.stdout, verb).not.toMatch(new RegExp(`\\n  ${verb}\\b`));
    }
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

  it("attaches, lists, unique-names on collision, and detaches on a commit", () => {
    const source = join(dir, "fixture.tsx");
    writeFileSync(source, "export const x = 1;\n");

    const attach1 = runCli(["task", "attach", "c1", source]);
    expect(attach1.status).toBe(0);
    expect(attach1.stdout).toContain("attached fixture.tsx (20 bytes)");
    expect(attach1.stdout).toContain(join(dir, "c1", "attachments", "fixture.tsx"));

    const list1 = runCli(["task", "attachments", "c1"]);
    expect(list1.status).toBe(0);
    expect(list1.stdout).toBe("fixture.tsx\t20\n");

    writeFileSync(source, "export const x = 2;\n");
    const attach2 = runCli(["task", "attach", "c1", source]);
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

    const detach = runCli(["task", "detach", "c1", "fixture.tsx"]);
    expect(detach.status).toBe(0);
    expect(detach.stdout).toBe("detached fixture.tsx from c1\n");
    expect(runCli(["task", "attachments", "c1"]).stdout).toBe("fixture-2.tsx\t20\n");

    expect(runCli(["task", "detach", "c1", "fixture-2.tsx"]).status).toBe(0);
    expect(runCli(["task", "attachments", "c1"]).stdout).toBe("(no attachments)\n");
  });

  it("allows attachments on epic and branch", () => {
    const source = join(dir, "ui.png");
    writeFileSync(source, "png-bytes");

    expect(runCli(["epic", "attach", "e", source]).status).toBe(0);
    expect(runCli(["story", "attach", "a", source]).status).toBe(0);
    expect(runCli(["epic", "attachments", "e"]).stdout).toContain("ui.png\t9\n");
    expect(runCli(["story", "attachments", "a"]).stdout).toContain("ui.png\t9\n");
  });

  it("prints attachments in view when present and omits them when empty", () => {
    const source = join(dir, "mock.tsx");
    writeFileSync(source, "canvas");
    expect(runCli(["task", "attach", "c1", source]).status).toBe(0);

    const withAttachments = runCli(["task", "view", "c1"]);
    expect(withAttachments.status).toBe(0);
    expect(withAttachments.stdout).toContain("Attachments:");
    expect(withAttachments.stdout).toContain(
      `mock.tsx (6 bytes) — ${join(dir, "c1", "attachments", "mock.tsx")}`,
    );

    expect(runCli(["task", "detach", "c1", "mock.tsx"]).status).toBe(0);
    const withoutAttachments = runCli(["task", "view", "c1"]);
    expect(withoutAttachments.status).toBe(0);
    expect(withoutAttachments.stdout).not.toContain("Attachments:");
  });

  it("prints project attachments in view when present and omits them when empty", () => {
    const source = join(dir, "vision.md");
    writeFileSync(source, "# Vision");
    expect(runCli(["project", "attach", "p", source]).status).toBe(0);

    const withAttachments = runCli(["project", "view", "p"]);
    expect(withAttachments.status).toBe(0);
    expect(withAttachments.stdout).toContain("Attachments:");
    expect(withAttachments.stdout).toContain(
      `vision.md (8 bytes) — ${join(dir, "p", "attachments", "vision.md")}`,
    );

    expect(runCli(["project", "detach", "p", "vision.md"]).status).toBe(0);
    const withoutAttachments = runCli(["project", "view", "p"]);
    expect(withoutAttachments.status).toBe(0);
    expect(withoutAttachments.stdout).not.toContain("Attachments:");
  });

  it("prints attachments in summary when present and omits them when empty", () => {
    const source = join(dir, "mock.tsx");
    writeFileSync(source, "canvas");
    expect(runCli(["task", "attach", "c1", source]).status).toBe(0);

    const withAttachments = runCli(["summary", "c1"]);
    expect(withAttachments.status).toBe(0);
    expect(withAttachments.stdout).toContain("  Attachments:");
    expect(withAttachments.stdout).toContain(
      `mock.tsx (6 bytes) — ${join(dir, "c1", "attachments", "mock.tsx")}`,
    );

    expect(runCli(["task", "detach", "c1", "mock.tsx"]).status).toBe(0);
    const withoutAttachments = runCli(["summary", "c1"]);
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
      join(dir, "a", "chat.jsonl"),
      JSON.stringify({ role: "agent", name: "bot", body: "first note", at: nextAt() }) +
        "\n",
    );
  });

  it.each([
    { kind: "project", id: "p" },
    { kind: "idea", id: "idea-1" },
    { kind: "epic", id: "e" },
    { kind: "story", id: "a" },
    { kind: "task", id: "c1" },
  ])("views a $kind via kind-scoped view", ({ kind, id }) => {
    const { stdout, status } = runCli([kind, "view", id]);
    expect(status).toBe(0);
    expect(stdout).toContain(`kind: ${kind}`);
  });

  it("supports --chat on kind-scoped view", () => {
    const { stdout, status } = runCli(["story", "view", "a", "--chat"]);
    expect(status).toBe(0);
    expect(stdout).toContain("--- chat ---");
    expect(stdout).toContain("bot: first note");
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
  ])("refuses kind mismatch for $name", ({ cmd, error }) => {
    const { stderr, status } = runCli(cmd());
    expect(status).toBe(1);
    expect(stderr).toContain(error);
  });

  it("comments on epic/idea/story/task via kind-scoped comment", () => {
    for (const [kind, id] of [
      ["epic", "e"],
      ["idea", "idea-1"],
      ["story", "a"],
      ["task", "c1"],
    ] as const) {
      const { stdout, status } = runCli([
        kind,
        "comment",
        id,
        "--role",
        "agent",
        "--body",
        `note on ${id}`,
      ]);
      expect(status, kind).toBe(0);
      expect(stdout, kind).toContain(`commented on ${id}`);
      expect(readFileSync(join(dir, id, "chat.jsonl"), "utf8")).toContain(
        `note on ${id}`,
      );
    }
  });

  it("does not register comment under project", () => {
    const help = runCli(["project", "--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).not.toMatch(/\n {2}comment\b/);
    const { stderr, status } = runCli([
      "project",
      "comment",
      "p",
      "--role",
      "agent",
      "--body",
      "nope",
    ]);
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/unknown command 'comment'/);
  });

  it("attaches on idea/epic/story/task via kind-scoped attach", () => {
    const source = join(dir, "note.txt");
    writeFileSync(source, "hello");
    for (const [kind, id] of [
      ["idea", "idea-1"],
      ["epic", "e"],
      ["story", "a"],
      ["task", "c1"],
    ] as const) {
      const attach = runCli([kind, "attach", id, source]);
      expect(attach.status, kind).toBe(0);
      expect(attach.stdout, kind).toContain("attached note.txt");
      const list = runCli([kind, "attachments", id]);
      expect(list.status, kind).toBe(0);
      expect(list.stdout, kind).toContain("note.txt\t5");
      const detach = runCli([kind, "detach", id, "note.txt"]);
      expect(detach.status, kind).toBe(0);
      expect(detach.stdout, kind).toBe(`detached note.txt from ${id}\n`);
    }
  });

  it("attaches on project via kind-scoped attach", () => {
    const source = join(dir, "note.txt");
    writeFileSync(source, "hello");
    const attach = runCli(["project", "attach", "p", source]);
    expect(attach.status).toBe(0);
    expect(attach.stdout).toContain("attached note.txt");
    const list = runCli(["project", "attachments", "p"]);
    expect(list.status).toBe(0);
    expect(list.stdout).toContain("note.txt\t5");
    const detach = runCli(["project", "detach", "p", "note.txt"]);
    expect(detach.status).toBe(0);
    expect(detach.stdout).toBe("detached note.txt from p\n");
  });

  it("deletes via kind-scoped delete", () => {
    writeIssue("c2", {
      kind: "task",
      title: "C2",
      partOf: "a",
      order: 1,
      status: "todo",
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    const { stdout, status } = runCli(["task", "delete", "c2"]);
    expect(status).toBe(0);
    expect(stdout).toContain("deleted c2");
    expect(runCli(["task", "view", "c2"]).status).toBe(1);
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

  function seedCatalog(
    ...labels: Array<{ id: string; color: string; description?: string }>
  ): void {
    for (const label of labels) {
      expect(
        runCli(["project", "set", "p", "labels", "--add", JSON.stringify(label)])
          .status,
      ).toBe(0);
    }
  }

  it("adds, updates, removes, renames, and clears the project catalog", () => {
    const bug = JSON.stringify({ id: "bug", color: "#ff0000" });
    expect(runCli(["project", "set", "p", "labels", "--add", bug]).status).toBe(0);
    expect(catalogOf()).toEqual([{ id: "bug", color: "#ff0000" }]);
    expect(runCli(["project", "get", "p", "labels"]).stdout).toBe(
      '[{"id":"bug","color":"#ff0000"}]\n',
    );

    const updated = JSON.stringify({
      id: "bug",
      color: "#aa0000",
      description: "Defects",
    });
    expect(runCli(["project", "set", "p", "labels", "--add", updated]).status).toBe(
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
      runCli(["project", "set", "p", "labels", "--add", "--file", featPath]).status,
    ).toBe(0);
    expect(catalogOf().map((l) => l.id)).toEqual(["bug", "feat"]);

    expect(
      runCli(["project", "set", "p", "labels", "--file", "-", "--add"], '{"id":"chore","color":"#0000ff"}')
        .status,
    ).toBe(0);
    expect(catalogOf().map((l) => l.id)).toEqual(["bug", "feat", "chore"]);

    expect(runCli(["project", "set", "p", "labels", "--remove", "chore"]).status).toBe(
      0,
    );
    expect(catalogOf().map((l) => l.id)).toEqual(["bug", "feat"]);

    expect(
      runCli(["project", "set", "p", "labels", "--rename", "bug", "defect"]).status,
    ).toBe(0);
    expect(catalogOf().map((l) => l.id)).toEqual(["defect", "feat"]);

    expect(runCli(["project", "set", "p", "labels", "--clear"]).status).toBe(0);
    expect(catalogOf()).toEqual([]);
    expect(runCli(["project", "get", "p", "labels"]).stdout).toBe("[]\n");
  });

  it("assigns, removes, and clears labels on epic/idea/story", () => {
    seedCatalog(
      { id: "bug", color: "#ff0000" },
      { id: "feat", color: "#00ff00" },
    );

    expect(runCli(["epic", "set", "e", "labels", "--add", "bug", "feat"]).status).toBe(
      0,
    );
    expect(labelsOf("e")).toEqual(["bug", "feat"]);
    expect(runCli(["epic", "get", "e", "labels"]).stdout).toBe('["bug","feat"]\n');

    expect(runCli(["idea", "set", "idea-a", "labels", "--add", "feat"]).status).toBe(
      0,
    );
    expect(labelsOf("idea-a")).toEqual(["feat"]);

    expect(runCli(["story", "set", "a", "labels", "--add", "bug"]).status).toBe(0);
    expect(labelsOf("a")).toEqual(["bug"]);

    expect(runCli(["epic", "set", "e", "labels", "--remove", "bug"]).status).toBe(0);
    expect(labelsOf("e")).toEqual(["feat"]);

    expect(runCli(["story", "set", "a", "labels", "--clear"]).status).toBe(0);
    expect(labelsOf("a")).toEqual([]);
    expect(runCli(["story", "get", "a", "labels"]).stdout).toBe("[]\n");
  });

  it("refuses unknown assignment ids", () => {
    seedCatalog({ id: "bug", color: "#ff0000" });
    const refused = runCli(["epic", "set", "e", "labels", "--add", "ghost"]);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toMatch(/unknown catalog id/);
    expect(labelsOf("e")).toEqual([]);
  });

  it("cascades catalog remove and rename onto assignments", () => {
    seedCatalog(
      { id: "bug", color: "#ff0000" },
      { id: "feat", color: "#00ff00" },
    );
    expect(runCli(["epic", "set", "e", "labels", "--add", "bug", "feat"]).status).toBe(
      0,
    );
    expect(runCli(["story", "set", "a", "labels", "--add", "bug"]).status).toBe(0);

    expect(runCli(["project", "set", "p", "labels", "--remove", "bug"]).status).toBe(
      0,
    );
    expect(labelsOf("e")).toEqual(["feat"]);
    expect(labelsOf("a")).toEqual([]);

    expect(runCli(["epic", "set", "e", "labels", "--add", "feat"]).status).toBe(0);
    expect(
      runCli(["project", "set", "p", "labels", "--rename", "feat", "feature"]).status,
    ).toBe(0);
    expect(labelsOf("e")).toEqual(["feature"]);
    expect(catalogOf().map((l) => l.id)).toEqual(["feature"]);
  });

  it("prints labels on view and tree chips, and omits them from summary", () => {
    seedCatalog(
      { id: "bug", color: "#ff0000" },
      { id: "feat", color: "#00ff00" },
    );
    expect(runCli(["epic", "set", "e", "labels", "--add", "bug", "feat"]).status).toBe(
      0,
    );
    expect(runCli(["idea", "set", "idea-a", "labels", "--add", "feat"]).status).toBe(
      0,
    );
    expect(runCli(["story", "set", "a", "labels", "--add", "bug"]).status).toBe(0);

    const projectView = runCli(["project", "view", "p"]);
    expect(projectView.status).toBe(0);
    expect(projectView.stdout).toContain("labels: bug, feat");

    const epicView = runCli(["epic", "view", "e"]);
    expect(epicView.status).toBe(0);
    expect(epicView.stdout).toContain("labels: bug, feat");

    const ideaView = runCli(["idea", "view", "idea-a"]);
    expect(ideaView.status).toBe(0);
    expect(ideaView.stdout).toContain("labels: feat");

    const storyView = runCli(["story", "view", "a"]);
    expect(storyView.status).toBe(0);
    expect(storyView.stdout).toContain("labels: bug");

    expect(runCli(["epic", "set", "e", "labels", "--clear"]).status).toBe(0);
    const clearedView = runCli(["epic", "view", "e"]);
    expect(clearedView.status).toBe(0);
    expect(clearedView.stdout).not.toContain("labels:");
    expect(runCli(["epic", "set", "e", "labels", "--add", "bug", "feat"]).status).toBe(
      0,
    );

    const tree = runCli(["tree", "p"]);
    expect(tree.status).toBe(0);
    expect(tree.stdout).toMatch(/^ {2}epic e\b.*\blabels=bug,feat\b/m);
    expect(tree.stdout).toMatch(/^ {2}idea idea-a\b.*\blabels=feat\b/m);
    expect(tree.stdout).toMatch(/^ {4}story a\b.*\blabels=bug\b/m);

    const summary = runCli(["summary", "a"]);
    expect(summary.status).toBe(0);
    expect(summary.stdout).not.toMatch(/\blabels\b/);
  });
});
