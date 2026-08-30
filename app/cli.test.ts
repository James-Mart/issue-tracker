import { spawn, spawnSync } from "child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runIssueCli } from "./cli-program.js";
import { DELETED_FIELD_VERBS } from "./deleted-field-verbs.js";

// Drive the CLI against a throwaway ISSUES_DIR. In-process cases use
// runIssueCli; EPIPE and the --help cold-boot spawn the thin cli.ts shell.
const appDir = dirname(fileURLToPath(import.meta.url));
const tsx = join(appDir, "node_modules", ".bin", "tsx");
const cliPath = join(appDir, "cli.ts");

let dir: string;
let clock = 0;

function env() {
  return {
    ISSUES_DIR: dir,
    ISSUE_TRACKER_SKIP_MODEL_SLUG_SYNC: "1",
  };
}

function nextAt(): string {
  clock += 1;
  return new Date(Date.UTC(2026, 6, 10, 14, 0, clock)).toISOString();
}

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function conversationsRoot(): string {
  return join(dirname(dir), "conversations");
}

function seedPlanningSession(
  convId: string,
  ideaId: string,
  projectId: string,
  opts?: { live?: boolean; transcriptLine?: string },
): void {
  const convDir = join(conversationsRoot(), convId);
  mkdirSync(convDir, { recursive: true });
  const now = nextAt();
  writeFileSync(
    join(convDir, "meta.json"),
    JSON.stringify({
      id: convId,
      title: "Plan",
      projectId,
      model: "auto",
      issueId: ideaId,
      channel: "planning",
      createdAt: now,
      updatedAt: now,
    }),
  );
  if (opts?.transcriptLine) {
    writeFileSync(join(convDir, "transcript.jsonl"), `${opts.transcriptLine}\n`);
  }
  if (opts?.live) {
    writeFileSync(
      join(convDir, "run-live.json"),
      `${JSON.stringify({ pid: process.pid })}\n`,
    );
  }
}

function spawnCliColdBoot(
  args: string[],
): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(tsx, [cliPath, ...args], {
    cwd: appDir,
    env: {
      ...process.env,
      ISSUES_DIR: dir,
      ISSUE_TRACKER_SKIP_MODEL_SLUG_SYNC: "1",
    },
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status,
  };
}

/** Spawn the real CLI and close stdout after the first chunk (broken pipe). */
function runCliWithEarlyStdoutClose(
  args: string[],
): Promise<{ status: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(tsx, [cliPath, ...args], {
      cwd: appDir,
      env: {
        ...process.env,
        ISSUES_DIR: dir,
        ISSUE_TRACKER_SKIP_MODEL_SLUG_SYNC: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.stdout?.once("data", () => {
      child.stdout?.destroy();
    });

    child.on("error", reject);
    child.on("close", (status) => {
      resolve({ status, stderr });
    });
  });
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

describe("thin shell cold-boot", () => {
  it("exits 0 for --help", async () => {
    const { status } = spawnCliColdBoot(["--help"]);
    expect(status).toBe(0);
  });
});

describe("EPIPE on stdout", () => {
  beforeEach(() => {
    writeIssue("p", {
      kind: "project",
      title: "Proj",
      order: 0,
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
    writeIssue("a", {
      kind: "story",
      title: "Branch A",
      partOf: "e",
      merged: false,
      order: 0,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeIssue("c1", {
      kind: "task",
      title: "C1",
      partOf: "a",
      status: "todo",
      order: 0,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
  });

  it("exits 0 quietly when stdout is closed early during verbose read-only output", async () => {
    const { status, stderr } = await runCliWithEarlyStdoutClose(["tree", "p"]);
    expect(status).toBe(0);
    expect(stderr).not.toMatch(/EPIPE/i);
    expect(stderr).not.toMatch(/Unhandled 'error' event/i);
  });
});

describe("removed commands", () => {
  it("rejects the removed ready command", async () => {
    const { status, stderr } = await runIssueCli(["ready", "--project", "p"], { env: env() });
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/unknown command/i);
  });
});

describe("--file - reads stdin on create", () => {
  it("seeds description.md from piped stdin through the create service", async () => {
    const { stdout, status } = await runIssueCli(["project", "add", "Stdin Project", "--file", "-"], { env: env(), stdin: "# Piped description\n\nfrom stdin\n" });
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

  it("wires the verb through to formatted stdout", async () => {
    const { stdout, status } = await runIssueCli(["summary", "c1"], { env: env() });
    expect(status).toBe(0);
    expect(stdout).toContain("Task: c1 — Do the thing");
    expect(stdout).toContain("For more details, try `issue <kind> view <id>` or `issue tree`.");
  });

  it("errors with a nonzero exit on an unknown id", async () => {
    const { stderr, status } = await runIssueCli(["summary", "ghost"], { env: env() });
    expect(status).toBe(1);
    expect(stderr).toContain('unknown issue "ghost"');
  });

  it("prints Workspace when set on the project", async () => {
    const ws = makeGitWorkspace();
    try {
      expect(
        (await runIssueCli(["project", "set", "p", "workspace", ws], { env: env() })).status,
      ).toBe(0);
      const { stdout, status } = await runIssueCli(["summary", "c1"], { env: env() });
      expect(status).toBe(0);
      expect(stdout).toContain(`  Workspace: ${ws}`);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it("omits Workspace when unset on the project", async () => {
    const { stdout, status } = await runIssueCli(["summary", "c1"], { env: env() });
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
      join(dir, "a", "comments.jsonl"),
      JSON.stringify({ role: "agent", name: "bot", body: "first note", at: nextAt() }) + "\n",
    );
  });

  it("prints metadata and description but not the comment log by default", async () => {
    const { stdout, status } = await runIssueCli(["story", "view", "a"], { env: env() });
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
    expect(stdout).not.toContain("--- comments ---");
  });

  it("appends the comment log with --comments", async () => {
    const { stdout, status } = await runIssueCli(["story", "view", "a", "--comments"], { env: env() });
    expect(status).toBe(0);
    expect(stdout).toContain("--- comments ---");
    expect(stdout).toContain("bot: first note");
  });

  it("errors with a nonzero exit on an unknown id", async () => {
    const { stderr, status } = await runIssueCli(["story", "view", "ghost"], { env: env() });
    expect(status).toBe(1);
    expect(stderr).toContain('unknown issue "ghost"');
  });

  it("prints an epic's blockedBy line when it has blockers", async () => {
    writeIssue("e2", {
      kind: "epic",
      title: "Epic 2",
      partOf: "p",
      blockedBy: ["e"],
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    const { stdout, status } = await runIssueCli(["epic", "view", "e2"], { env: env() });
    expect(status).toBe(0);
    expect(stdout).toContain("kind: epic");
    expect(stdout).toContain("blockedBy: e");
  });

  it("omits the blockedBy line for an epic with no blockers", async () => {
    const { stdout, status } = await runIssueCli(["epic", "view", "e"], { env: env() });
    expect(status).toBe(0);
    expect(stdout).toContain("kind: epic");
    expect(stdout).not.toContain("blockedBy:");
  });

  it("prints sourceIdea on an epic or story when set and omits it when unset", async () => {
    writeIssue("idea-v", {
      kind: "idea",
      title: "Capture",
      partOf: "p",
      order: 10,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeIssue("e-with-idea", {
      kind: "epic",
      title: "Epic with idea",
      partOf: "p",
      order: 11,
      blockedBy: [],
      sourceIdea: "idea-v",
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeIssue("s-with-idea", {
      kind: "story",
      title: "Story with idea",
      partOf: "p",
      order: 12,
      merged: false,
      sourceIdea: "idea-v",
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });

    const epicSet = await runIssueCli(["view", "e-with-idea"], { env: env() });
    expect(epicSet.status).toBe(0);
    expect(epicSet.stdout).toContain("sourceIdea: idea-v");

    const storySet = await runIssueCli(["view", "s-with-idea"], { env: env() });
    expect(storySet.status).toBe(0);
    expect(storySet.stdout).toContain("sourceIdea: idea-v");

    const epicUnset = await runIssueCli(["view", "e"], { env: env() });
    expect(epicUnset.status).toBe(0);
    expect(epicUnset.stdout).not.toContain("sourceIdea:");

    const storyUnset = await runIssueCli(["view", "a"], { env: env() });
    expect(storyUnset.status).toBe(0);
    expect(storyUnset.stdout).not.toContain("sourceIdea:");
  });

  it("prints plan not final on tree for roots whose source Idea is unarchived", async () => {
    writeIssue("idea-v", {
      kind: "idea",
      title: "Capture",
      partOf: "p",
      order: 10,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeIssue("e-with-idea", {
      kind: "epic",
      title: "Epic with idea",
      partOf: "p",
      order: 11,
      blockedBy: [],
      sourceIdea: "idea-v",
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeIssue("s-with-idea", {
      kind: "story",
      title: "Story with idea",
      partOf: "p",
      order: 12,
      merged: false,
      sourceIdea: "idea-v",
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });

    const treeOpen = await runIssueCli(["tree", "p"], { env: env() });
    expect(treeOpen.status).toBe(0);
    expect(treeOpen.stdout).toMatch(/^ {2}epic e-with-idea\b.*\bplan not final\b/m);
    expect(treeOpen.stdout).toMatch(/^ {2}story s-with-idea\b.*\bplan not final\b/m);
    expect(treeOpen.stdout).not.toMatch(/^ {2}epic e  Epic\b.*\bplan not final\b/m);

    writeIssue("idea-v", {
      kind: "idea",
      title: "Capture",
      partOf: "p",
      order: 10,
      archived: true,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    const treeFinal = await runIssueCli(["tree", "p"], { env: env() });
    expect(treeFinal.status).toBe(0);
    expect(treeFinal.stdout).not.toMatch(/\bplan not final\b/);
  });

  it("prints workspace when set on a project", async () => {
    const ws = makeGitWorkspace();
    try {
      const { status: setStatus } = await runIssueCli(["project", "set", "p", "workspace", ws], { env: env() });
      expect(setStatus).toBe(0);
      const { stdout, status } = await runIssueCli(["project", "view", "p"], { env: env() });
      expect(status).toBe(0);
      expect(stdout).toContain(`workspace: ${ws}`);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it("omits workspace when unset on a project", async () => {
    const { stdout, status } = await runIssueCli(["project", "view", "p"], { env: env() });
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

  it("gets and sets allowlisted project fields", async () => {
    expect((await runIssueCli(["project", "get", "p", "title"], { env: env() })).stdout).toBe("Proj\n");
    expect((await runIssueCli(["project", "get", "p", "mergePolicy"], { env: env() })).stdout).toBe("manual\n");
    expect((await runIssueCli(["project", "get", "p", "description"], { env: env() })).stdout).toBe("# Proj\n\nbody\n");

    expect((await runIssueCli(["project", "set", "p", "title", "Renamed"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["project", "get", "p", "title"], { env: env() })).stdout).toBe("Renamed\n");

    expect((await runIssueCli(["project", "set", "p", "mergePolicy", "pull-request"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["project", "get", "p", "mergePolicy"], { env: env() })).stdout).toBe("pull-request\n");
  });

  it("sets description from --file and clears workspace with --clear", async () => {
    const descFile = join(dir, "desc.md");
    writeFileSync(descFile, "from file\n");
    expect(
      (await runIssueCli(["project", "set", "p", "description", "--file", descFile], { env: env() })).status,
    ).toBe(0);
    expect((await runIssueCli(["project", "get", "p", "description"], { env: env() })).stdout).toBe("from file\n");

    const ws = makeGitWorkspace();
    try {
      expect((await runIssueCli(["project", "set", "p", "workspace", ws], { env: env() })).status).toBe(0);
      expect((await runIssueCli(["project", "get", "p", "workspace"], { env: env() })).stdout).toBe(`${ws}\n`);
      expect((await runIssueCli(["project", "set", "p", "workspace", "--clear"], { env: env() })).status).toBe(0);
      const { stdout, status } = await runIssueCli(["project", "get", "p", "workspace"], { env: env() });
      expect(status).toBe(0);
      expect(stdout).toBe("");
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it("prints empty stdout for unset optional get", async () => {
    const { stdout, status } = await runIssueCli(["project", "get", "p", "workspace"], { env: env() });
    expect(status).toBe(0);
    expect(stdout).toBe("");
  });

  it("refuses kind mismatch and unknown fields", async () => {
    const mismatch = await runIssueCli(["project", "get", "e", "title"], { env: env() });
    expect(mismatch.status).toBe(1);
    expect(mismatch.stderr).toContain('"e" is an epic, not a project');

    const setMismatch = await runIssueCli(["project", "set", "e", "title", "Nope"], { env: env() });
    expect(setMismatch.status).toBe(1);
    expect(setMismatch.stderr).toContain('"e" is an epic, not a project');

    const unknownGet = await runIssueCli(["project", "get", "p", "assignee"], { env: env() });
    expect(unknownGet.status).toBe(1);
    expect(unknownGet.stderr).toContain('unknown field "assignee" for project');

    const unknownSet = await runIssueCli(["project", "set", "p", "assignee", "bot"], { env: env() });
    expect(unknownSet.status).toBe(1);
    expect(unknownSet.stderr).toContain(
      'unknown or unsettable field "assignee" for project',
    );
  });

  it("wires mergePolicy through to view", async () => {
    expect((await runIssueCli(["project", "set", "p", "mergePolicy", "pull-request"], { env: env() })).status).toBe(0);
    const { stdout, status } = await runIssueCli(["project", "view", "p"], { env: env() });
    expect(status).toBe(0);
    expect(stdout).toContain("mergePolicy: pull-request");
  });

  it("sets, gets, clears, and surfaces supportingDocs", async () => {
    const ws = makeGitWorkspace();
    const visionSrc = join(dir, "vision.md");
    writeFileSync(visionSrc, "# Vision");
    writeFileSync(join(ws, "standards.md"), "# Standards");
    try {
      expect((await runIssueCli(["project", "set", "p", "workspace", ws], { env: env() })).status).toBe(0);
      expect((await runIssueCli(["project", "attach", "p", visionSrc], { env: env() })).status).toBe(0);

      expect(
        (await runIssueCli([
          "project",
          "set",
          "p",
          "supportingDocs",
          "--doc",
          "vision",
          "--attachment",
          "vision.md",
        ], { env: env() })).status,
      ).toBe(0);
      expect(
        (await runIssueCli([
          "project",
          "set",
          "p",
          "supportingDocs",
          "--doc",
          "codingStandards",
          "--workspace",
          "standards.md",
        ], { env: env() })).status,
      ).toBe(0);

      const got = await runIssueCli(["project", "get", "p", "supportingDocs"], { env: env() });
      expect(got.status).toBe(0);
      expect(JSON.parse(got.stdout)).toEqual({
        vision: { type: "attachment", name: "vision.md" },
        codingStandards: { type: "workspace", path: "standards.md" },
      });

      const view = await runIssueCli(["project", "view", "p"], { env: env() });
      expect(view.status).toBe(0);
      expect(view.stdout).toContain(
        "supportingDocs: vision=attachment:vision.md, codingStandards=workspace:standards.md",
      );

      const summary = await runIssueCli(["summary", "p"], { env: env() });
      expect(summary.status).toBe(0);
      expect(summary.stdout).toContain(
        "supportingDocs: vision=attachment:vision.md, codingStandards=workspace:standards.md",
      );

      expect(
        (await runIssueCli([
          "project",
          "set",
          "p",
          "supportingDocs",
          "--clear",
          "--doc",
          "vision",
        ], { env: env() })).status,
      ).toBe(0);
      expect(JSON.parse((await runIssueCli(["project", "get", "p", "supportingDocs"], { env: env() })).stdout)).toEqual({
        codingStandards: { type: "workspace", path: "standards.md" },
      });

      expect((await runIssueCli(["project", "set", "p", "supportingDocs", "--clear"], { env: env() })).status).toBe(0);
      expect((await runIssueCli(["project", "get", "p", "supportingDocs"], { env: env() })).stdout).toBe("");
      expect((await runIssueCli(["project", "view", "p"], { env: env() })).stdout).not.toContain("supportingDocs:");
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it("prints Mission from the vision doc on summary", async () => {
    const visionSrc = join(dir, "vision-with-mission.md");
    writeFileSync(
      visionSrc,
      "# Vision\n\n## Mission\n\nHelp humans and agents ship together.\n\n## North star\n\nMore detail.",
    );
    try {
      expect((await runIssueCli(["project", "attach", "p", visionSrc], { env: env() })).status).toBe(0);
      expect(
        (await runIssueCli([
          "project",
          "set",
          "p",
          "supportingDocs",
          "--doc",
          "vision",
          "--attachment",
          "vision-with-mission.md",
        ], { env: env() })).status,
      ).toBe(0);

      const summary = await runIssueCli(["summary", "p"], { env: env() });
      expect(summary.status).toBe(0);
      expect(summary.stdout).toContain(
        "  Mission: Help humans and agents ship together.",
      );
      expect(summary.stdout.indexOf("  Mission:")).toBeLessThan(
        summary.stdout.indexOf("  supportingDocs:"),
      );
    } finally {
      expect(
        (await runIssueCli([
          "project",
          "set",
          "p",
          "supportingDocs",
          "--clear",
        ], { env: env() })).status,
      ).toBe(0);
    }
  });

  it("sets, gets, clears, and surfaces inspirationApps", async () => {
    expect(
      (await runIssueCli([
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
      ], { env: env() })).status,
    ).toBe(0);
    expect(
      (await runIssueCli([
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
      ], { env: env() })).status,
    ).toBe(0);

    const got = await runIssueCli(["project", "get", "p", "inspirationApps"], { env: env() });
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
    expect((await runIssueCli(["project", "view", "p"], { env: env() })).stdout).toContain(line);
    expect((await runIssueCli(["summary", "p"], { env: env() })).stdout).toContain(line);

    expect(
      (await runIssueCli(["project", "set", "p", "inspirationApps", "--remove", "Notion"], { env: env() }))
        .status,
    ).toBe(0);
    expect(JSON.parse((await runIssueCli(["project", "get", "p", "inspirationApps"], { env: env() })).stdout)).toEqual([
      {
        name: "Figma",
        url: "https://figma.com",
        description: "Design tool",
      },
    ]);

    expect((await runIssueCli(["project", "set", "p", "inspirationApps", "--clear"], { env: env() })).status).toBe(0);
    expect(JSON.parse((await runIssueCli(["project", "get", "p", "inspirationApps"], { env: env() })).stdout)).toEqual([]);
    expect((await runIssueCli(["project", "view", "p"], { env: env() })).stdout).not.toContain("inspirationApps:");
  });

  it("refuses inspirationApps on non-project kinds", async () => {
    const set = await runIssueCli([
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
    ], { env: env() });
    expect(set.status).toBe(1);
    expect(set.stderr).toContain('unknown or unsettable field "inspirationApps" for epic');
  });

  it("sets, gets, clears, and surfaces personas", async () => {
    expect(
      (await runIssueCli([
        "project",
        "set",
        "p",
        "personas",
        "--add",
        JSON.stringify({
          name: "Planner",
          description: "Plans work",
        }),
      ], { env: env() })).status,
    ).toBe(0);
    expect(
      (await runIssueCli([
        "project",
        "set",
        "p",
        "personas",
        "--add",
        JSON.stringify({
          name: "Implementor",
          description: "Writes code",
        }),
      ], { env: env() })).status,
    ).toBe(0);

    const got = await runIssueCli(["project", "get", "p", "personas"], { env: env() });
    expect(got.status).toBe(0);
    expect(JSON.parse(got.stdout)).toEqual([
      { name: "Planner", description: "Plans work" },
      { name: "Implementor", description: "Writes code" },
    ]);

    const line =
      "personas: Planner — Plans work, Implementor — Writes code";
    expect((await runIssueCli(["project", "view", "p"], { env: env() })).stdout).toContain(line);
    expect((await runIssueCli(["summary", "p"], { env: env() })).stdout).toContain(line);

    expect(
      (await runIssueCli(["project", "set", "p", "personas", "--remove", "Planner"], { env: env() })).status,
    ).toBe(0);
    expect(JSON.parse((await runIssueCli(["project", "get", "p", "personas"], { env: env() })).stdout)).toEqual([
      { name: "Implementor", description: "Writes code" },
    ]);

    expect((await runIssueCli(["project", "set", "p", "personas", "--clear"], { env: env() })).status).toBe(0);
    expect(JSON.parse((await runIssueCli(["project", "get", "p", "personas"], { env: env() })).stdout)).toEqual([]);
    expect((await runIssueCli(["project", "view", "p"], { env: env() })).stdout).not.toContain("personas:");
  });

  it("refuses personas on non-project kinds", async () => {
    const set = await runIssueCli([
      "epic",
      "set",
      "e",
      "personas",
      "--add",
      JSON.stringify({
        name: "Planner",
        description: "Plans work",
      }),
    ], { env: env() });
    expect(set.status).toBe(1);
    expect(set.stderr).toContain('unknown or unsettable field "personas" for epic');
  });

  it("refuses invalid supportingDocs sets", async () => {
    const ws = makeGitWorkspace();
    try {
      expect((await runIssueCli(["project", "set", "p", "workspace", ws], { env: env() })).status).toBe(0);

      const missingAttach = await runIssueCli([
        "project",
        "set",
        "p",
        "supportingDocs",
        "--doc",
        "vision",
        "--attachment",
        "vision.md",
      ], { env: env() });
      expect(missingAttach.status).toBe(1);
      expect(missingAttach.stderr).toContain("not attached");

      const badPath = await runIssueCli([
        "project",
        "set",
        "p",
        "supportingDocs",
        "--doc",
        "vision",
        "--workspace",
        "../escape.md",
      ], { env: env() });
      expect(badPath.status).toBe(1);
      expect(badPath.stderr).toMatch(/\.\.|relative|escape/i);

      const unknownKey = await runIssueCli([
        "project",
        "set",
        "p",
        "supportingDocs",
        "--doc",
        "roadmap",
        "--workspace",
        "x.md",
      ], { env: env() });
      expect(unknownKey.status).toBe(1);
      expect(unknownKey.stderr).toContain("unknown supportingDocs key");

      const missingFile = await runIssueCli([
        "project",
        "set",
        "p",
        "supportingDocs",
        "--doc",
        "vision",
        "--workspace",
        "missing.md",
      ], { env: env() });
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

  it("shows --part-of on idea add --help", async () => {
    const { stdout, status } = await runIssueCli(["idea", "add", "--help"], { env: env() });
    expect(status).toBe(0);
    expect(stdout).toMatch(/--part-of/);
    expect(stdout).not.toMatch(/--project/);
  });

  it("adds an idea without a description and prints its id", async () => {
    const { stdout, status } = await runIssueCli(["idea", "add", "--part-of", "p", "Capture me"], { env: env() });
    expect(status).toBe(0);
    const id = stdout.trim();
    expect(id).toBe("capture-me");
    expect(issueJsonField("capture-me", "kind")).toBe("idea");
    expect(issueJsonField("capture-me", "partOf")).toBe("p");
    expect(issueJsonField("capture-me", "title")).toBe("Capture me");
    expect(readFileSync(join(dir, id, "description.md"), "utf8")).toBe("# Capture me\n");
  });

  it("adds an idea with --description", async () => {
    const { stdout, status } = await runIssueCli([
      "idea",
      "add",
      "--part-of",
      "p",
      "With body",
      "--description",
      "# Idea\n\nnotes\n",
    ], { env: env() });
    expect(status).toBe(0);
    const id = stdout.trim();
    expect(id).toBe("with-body");
    expect(readFileSync(join(dir, id, "description.md"), "utf8")).toBe("# Idea\n\nnotes\n");
  });

  it("adds an idea with --file", async () => {
    const descFile = join(dir, "idea-desc.md");
    writeFileSync(descFile, "# From file\n\nseeded\n");
    const { stdout, status } = await runIssueCli([
      "idea",
      "add",
      "--part-of",
      "p",
      "From file",
      "--file",
      descFile,
    ], { env: env() });
    expect(status).toBe(0);
    const id = stdout.trim();
    expect(id).toBe("from-file");
    expect(readFileSync(join(dir, id, "description.md"), "utf8")).toBe(
      "# From file\n\nseeded\n",
    );
  });

  it("gets and sets title, archived, partOf, and description", async () => {
    expect((await runIssueCli(["idea", "add", "--part-of", "p", "Mine later"], { env: env() })).status).toBe(0);
    writeFileSync(join(dir, "mine-later", "description.md"), "# Idea\n\nbody\n");

    expect((await runIssueCli(["idea", "get", "mine-later", "title"], { env: env() })).stdout).toBe("Mine later\n");
    expect((await runIssueCli(["idea", "get", "mine-later", "partOf"], { env: env() })).stdout).toBe("p\n");
    expect((await runIssueCli(["idea", "get", "mine-later", "archived"], { env: env() })).stdout).toBe("false\n");
    expect((await runIssueCli(["idea", "get", "mine-later", "description"], { env: env() })).stdout).toBe("# Idea\n\nbody\n");

    expect((await runIssueCli(["idea", "set", "mine-later", "title", "Renamed"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["idea", "get", "mine-later", "title"], { env: env() })).stdout).toBe("Renamed\n");

    expect((await runIssueCli(["idea", "set", "mine-later", "archived", "true"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["idea", "get", "mine-later", "archived"], { env: env() })).stdout).toBe("true\n");

    expect((await runIssueCli(["idea", "set", "mine-later", "partOf", "p2"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["idea", "get", "mine-later", "partOf"], { env: env() })).stdout).toBe("p2\n");

    expect((await runIssueCli(["idea", "set", "mine-later", "description", "updated\n"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["idea", "get", "mine-later", "description"], { env: env() })).stdout).toBe("updated\n");
  });

  it("rejects add and set when the parent is not a project", async () => {
    const badAdd = await runIssueCli(["idea", "add", "--part-of", "e", "Bad parent"], { env: env() });
    expect(badAdd.status).toBe(1);
    expect(badAdd.stderr).toMatch(/must be a project/);

    expect((await runIssueCli(["idea", "add", "--part-of", "p", "Ok"], { env: env() })).status).toBe(0);
    const badSet = await runIssueCli(["idea", "set", "ok", "partOf", "e"], { env: env() });
    expect(badSet.status).toBe(1);
    expect(badSet.stderr).toMatch(/must be a project/);
  });

  it("refuses kind mismatch and unknown fields", async () => {
    expect((await runIssueCli(["idea", "add", "--part-of", "p", "Mine"], { env: env() })).status).toBe(0);

    const mismatch = await runIssueCli(["idea", "get", "e", "title"], { env: env() });
    expect(mismatch.status).toBe(1);
    expect(mismatch.stderr).toContain('"e" is an epic, not an idea');

    const setMismatch = await runIssueCli(["idea", "set", "e", "title", "Nope"], { env: env() });
    expect(setMismatch.status).toBe(1);
    expect(setMismatch.stderr).toContain('"e" is an epic, not an idea');

    const unknownGet = await runIssueCli(["idea", "get", "mine", "assignee"], { env: env() });
    expect(unknownGet.status).toBe(1);
    expect(unknownGet.stderr).toContain('unknown field "assignee" for idea');

    const unknownSet = await runIssueCli(["idea", "set", "mine", "assignee", "bot"], { env: env() });
    expect(unknownSet.status).toBe(1);
    expect(unknownSet.stderr).toContain(
      'unknown or unsettable field "assignee" for idea',
    );
  });

  it("sets, gets, and clears stakeholder on an idea", async () => {
    expect((await runIssueCli(["idea", "add", "--part-of", "p", "Plan this"], { env: env() })).status).toBe(0);

    expect(
      (await runIssueCli(["idea", "set", "plan-this", "stakeholder", "composer-2.5"], { env: env() })).status,
    ).toBe(0);
    expect(issueJsonField("plan-this", "stakeholder")).toBe("composer-2.5");
    expect((await runIssueCli(["idea", "get", "plan-this", "stakeholder"], { env: env() })).stdout.trim()).toBe(
      "composer-2.5",
    );

    expect(
      (await runIssueCli(["idea", "set", "plan-this", "stakeholder", "--clear"], { env: env() })).status,
    ).toBe(0);
    expect("stakeholder" in JSON.parse(readFileSync(join(dir, "plan-this", "issue.json"), "utf8"))).toBe(
      false,
    );
    expect((await runIssueCli(["idea", "get", "plan-this", "stakeholder"], { env: env() })).stdout).toBe("");
  });

  it("refuses an unknown stakeholder slug on create and set", async () => {
    const badAdd = await runIssueCli([
      "idea",
      "add",
      "--part-of",
      "p",
      "--stakeholder",
      "not-a-model",
      "Bad slug",
    ], { env: env() });
    expect(badAdd.status).toBe(1);
    expect(badAdd.stderr).toContain("unknown agent model slug");

    expect((await runIssueCli(["idea", "add", "--part-of", "p", "Ok idea"], { env: env() })).status).toBe(0);
    const badSet = await runIssueCli([
      "idea",
      "set",
      "ok-idea",
      "stakeholder",
      "not-a-model",
    ], { env: env() });
    expect(badSet.status).toBe(1);
    expect(badSet.stderr).toContain("unknown agent model slug");
  });

  it("creates an idea with --stakeholder", async () => {
    const { stdout, status } = await runIssueCli([
      "idea",
      "add",
      "--part-of",
      "p",
      "--stakeholder",
      "composer-2.5",
      "Auto plan",
    ], { env: env() });
    expect(status).toBe(0);
    const id = stdout.trim();
    expect(issueJsonField(id, "stakeholder")).toBe("composer-2.5");
  });
});

describe("idea ideaStatus", () => {
  beforeEach(() => {
    rmSync(conversationsRoot(), { recursive: true, force: true });
    writeIssue("p", { kind: "project", title: "Proj", createdAt: nextAt(), updatedAt: nextAt() });
    writeIssue("capture", {
      kind: "idea",
      title: "Capture",
      partOf: "p",
      order: 0,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
  });

  it("gets derived ideaStatus and shows it on tree", async () => {
    expect((await runIssueCli(["idea", "get", "capture", "ideaStatus"], { env: env() })).stdout).toBe("captured\n");

    const tree = await runIssueCli(["tree", "p"], { env: env() });
    expect(tree.status).toBe(0);
    expect(tree.stdout).toMatch(/^ {2}idea capture\b.*\bstatus=captured\b/m);
  });

  it("reports planning when a planning session run is live", async () => {
    seedPlanningSession("plan-live", "capture", "p", { live: true });

    expect((await runIssueCli(["idea", "get", "capture", "ideaStatus"], { env: env() })).stdout).toBe("planning\n");

    const tree = await runIssueCli(["tree", "p"], { env: env() });
    expect(tree.status).toBe(0);
    expect(tree.stdout).toMatch(/^ {2}idea capture\b.*\bstatus=planning\b/m);
  });

  it("reports awaiting-direction when a session stopped without a plan", async () => {
    seedPlanningSession("plan-stopped", "capture", "p", {
      transcriptLine: JSON.stringify({
        type: "assistant",
        text: "What should this become?",
        at: nextAt(),
      }),
    });

    expect((await runIssueCli(["idea", "get", "capture", "ideaStatus"], { env: env() })).stdout).toBe(
      "awaiting-direction\n",
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

  it("adds a project and prints its id", async () => {
    const { stdout, status } = await runIssueCli(["project", "add", "New Project"], { env: env() });
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
  ])("adds $kind under the correct parent with assignee", async ({ args, id, partOf, assignee }) => {
    const result = await runIssueCli(args, { env: env() });
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
  ])("rejects $kind add with --assignee", async ({ args }) => {
    const result = await runIssueCli(args, { env: env() });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/unknown option '--assignee'/);
  });

  it("seeds description from --description and --file without --description-file", async () => {
    const inline = await runIssueCli([
      "project",
      "add",
      "Inline Desc",
      "--description",
      "# Inline\n",
    ], { env: env() });
    expect(inline.status).toBe(0);
    expect(readFileSync(join(dir, "inline-desc", "description.md"), "utf8")).toBe(
      "# Inline\n",
    );

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

    const help = await runIssueCli(["project", "add", "--help"], { env: env() });
    expect(help.status).toBe(0);
    expect(help.stdout).toMatch(/--file <path>/);
    expect(help.stdout).not.toMatch(/--description[_-]file/);
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

  it("interleaves Ideas and Epics by order in tree with Idea status chips", async () => {
    const { stdout, status } = await runIssueCli(["tree", "p"], { env: env() });
    expect(status).toBe(0);
    expect(stdout).toMatch(/^project p {2}Proj$/m);
    expect(stdout).toMatch(/^ {2}idea idea-a\b.*\bstatus=captured\b/m);
    expect(stdout).toMatch(/^ {2}epic e {2}Epic\b/m);
    expect(stdout).toMatch(/^ {2}idea idea-b\b.*\bstatus=captured\b/m);
    const ideaA = stdout.indexOf("idea idea-a");
    const epic = stdout.indexOf("epic e");
    const ideaB = stdout.indexOf("idea idea-b");
    expect(ideaA).toBeLessThan(epic);
    expect(epic).toBeLessThan(ideaB);
  });

  it("interleaves project-level Stories with Epics and Ideas and nests stacked children", async () => {
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

    const { stdout, status } = await runIssueCli(["tree", "p"], { env: env() });
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

    const summary = await runIssueCli(["summary", "solo-t"], { env: env() });
    expect(summary.status).toBe(0);
    expect(summary.stdout).toContain("Project: p — Proj");
    expect(summary.stdout).toContain("Story: solo — Solo Story");
    expect(summary.stdout).toContain("Task: solo-t — Solo task");
    expect(summary.stdout).not.toContain("Epic:");
  });

  it("includes Ideas in list JSON for the project", async () => {
    const { stdout, status } = await runIssueCli(["list", "--in", "p"], { env: env() });
    expect(status).toBe(0);
    const listed = JSON.parse(stdout);
    const ids = listed.issues.map((i: { id: string }) => i.id).sort();
    expect(ids).toEqual(["e", "idea-a", "idea-b", "p"]);
    const idea = listed.issues.find((i: { id: string }) => i.id === "idea-a");
    expect(idea.kind).toBe("idea");
  });

  it("summarizes an Idea as Project then Idea", async () => {
    const { stdout, status } = await runIssueCli(["summary", "idea-a"], { env: env() });
    expect(status).toBe(0);
    expect(stdout).toContain("Project: p — Proj");
    expect(stdout).toContain("Idea: idea-a — Capture first");
    expect(stdout).not.toContain("Description:");
    expect(stdout).not.toContain("Epic:");
  });

  it("hides archived Ideas from tree/list unless --show-archived", async () => {
    expect((await runIssueCli(["idea", "set", "idea-a", "archived", "true"], { env: env() })).status).toBe(0);

    const treeHidden = await runIssueCli(["tree", "p"], { env: env() });
    expect(treeHidden.status).toBe(0);
    expect(treeHidden.stdout).toContain("idea idea-b");
    expect(treeHidden.stdout).not.toContain("idea idea-a");

    const treeShown = await runIssueCli(["tree", "p", "--show-archived"], { env: env() });
    expect(treeShown.status).toBe(0);
    expect(treeShown.stdout).toContain("idea idea-a");

    const listHidden = JSON.parse((await runIssueCli(["list", "--in", "p"], { env: env() })).stdout);
    expect(listHidden.issues.map((i: { id: string }) => i.id).sort()).toEqual(
      ["e", "idea-b", "p"],
    );

    const listShown = JSON.parse(
      (await runIssueCli(["list", "--in", "p", "--show-archived"], { env: env() })).stdout,
    );
    expect(listShown.issues.map((i: { id: string }) => i.id).sort()).toEqual(
      ["e", "idea-a", "idea-b", "p"],
    );
  });

  it("echoes mixed Idea/Epic order from apply-root", async () => {
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
    const { stdout, status } = await runIssueCli(["apply", applyPath], { env: env() });
    expect(status).toBe(0);
    expect(stdout).toMatch(/^project p {2}Proj$/m);
    expect(stdout).toMatch(/^ {2}epic e {2}Epic\b/m);
    expect(stdout).toMatch(/^ {2}idea idea-a\b.*\bstatus=captured\b/m);
    expect(stdout).toMatch(/^ {2}idea idea-b\b.*\bstatus=captured\b/m);
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

    expect((await runIssueCli(["task", "set", "c1", "commitSha", sha1], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["task", "get", "c1", "commitSha"], { env: env() })).stdout).toBe(`${sha1}\n`);
    expect((await runIssueCli(["task", "set", "c1", "commitSha", "--clear"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["task", "get", "c1", "commitSha"], { env: env() })).stdout).toBe("");

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

  it("refuses kind mismatch, unknown fields, and invalid commitSha / noDiff", async () => {
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

    const badSha = await runIssueCli(["task", "set", "c1", "commitSha", "4019c25"], { env: env() });
    expect(badSha.status).toBe(1);
    expect(badSha.stderr).toMatch(/invalid commit sha "4019c25"/);

    const shortSha = await runIssueCli([
      "task",
      "set",
      "c1",
      "commitSha",
      "0123456789abcdef0123456789abcdef0123456",
    ], { env: env() });
    expect(shortSha.status).toBe(1);
    expect(shortSha.stderr).toMatch(/invalid commit sha/);

    const nonHex = await runIssueCli([
      "task",
      "set",
      "c1",
      "commitSha",
      "ghijghijghijghijghijghijghijghijghijghij",
    ], { env: env() });
    expect(nonHex.status).toBe(1);
    expect(nonHex.stderr).toMatch(/invalid commit sha/);

    const upper = await runIssueCli([
      "task",
      "set",
      "c1",
      "commitSha",
      "0123456789ABCDEF0123456789ABCDEF01234567",
    ], { env: env() });
    expect(upper.status).toBe(1);
    expect(upper.stderr).toMatch(/invalid commit sha/);

    expect((await runIssueCli(["task", "set", "a", "commitSha", sha1], { env: env() })).stderr).toMatch(
      /"a" is a story, not a task/,
    );
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

  it("accepts sha256 commitSha and surfaces noDiff in view/summary", async () => {
    expect((await runIssueCli(["task", "set", "c1", "commitSha", sha256], { env: env() })).status).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "c1", "issue.json"), "utf8")).commitSha).toBe(
      sha256,
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

  it("renders indentation, chips, and stacked depth-first order", async () => {
    const { stdout, status } = await runIssueCli(["tree", "p"], { env: env() });
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

  it("shows mergeBase=(unset) for a stacked child whose mergeBase is not set yet", async () => {
    // Create via the CLI: child of an unnamed parent leaves derived mergeBase
    // unset until the parent gets a branchName.
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
    const { stdout, status } = await runIssueCli(["tree", "p"], { env: env() });
    expect(status).toBe(0);
    expect(stdout).toMatch(
      new RegExp(`^\\s+story ${childId}\\b.*\\bmergeBase=\\(unset\\)`, "m"),
    );
  });

  it("scopes by a positional project id", async () => {
    const { stdout, status } = await runIssueCli(["tree", "p"], { env: env() });
    expect(status).toBe(0);
    expect(stdout).toMatch(/^project p {2}Proj$/m);
    expect(stdout).toContain("epic e");
  });

  it("scopes by a positional epic id", async () => {
    const { stdout, status } = await runIssueCli(["tree", "e"], { env: env() });
    expect(status).toBe(0);
    expect(stdout).toMatch(/^epic e {2}Epic\b/m);
    expect(stdout).toContain("story a");
    expect(stdout).not.toContain("project p");
  });

  it("scopes by a positional story id to that story and its tasks only", async () => {
    const { stdout, status } = await runIssueCli(["tree", "a"], { env: env() });
    expect(status).toBe(0);
    expect(stdout).toMatch(/^story a {2}Branch A\b/m);
    expect(stdout).toMatch(/^ {2}task c1 {2}C1\b/m);
    expect(stdout).not.toContain("story b");
    expect(stdout).not.toContain("epic e");
  });

  it("refuses a positional task id and names the parent story", async () => {
    const { stderr, status } = await runIssueCli(["tree", "c1"], { env: env() });
    expect(status).toBe(1);
    expect(stderr).toContain("cannot scope tree to a task");
    expect(stderr).toContain('story "a"');
  });

  it("refuses an unknown positional id", async () => {
    const { stderr, status } = await runIssueCli(["tree", "ghost"], { env: env() });
    expect(status).toBe(1);
    expect(stderr).toContain('unknown issue "ghost"');
  });

  it("refuses title lookup and dropped scope flags", async () => {
    const byTitle = await runIssueCli(["tree", "Proj"], { env: env() });
    expect(byTitle.status).toBe(1);
    expect(byTitle.stderr).toContain('unknown issue "Proj"');

    const withProject = await runIssueCli(["tree", "--project", "p"], { env: env() });
    expect(withProject.status).not.toBe(0);
    expect(withProject.stderr).toMatch(/unknown option '--project'/);

    const withEpic = await runIssueCli(["tree", "--epic", "e"], { env: env() });
    expect(withEpic.status).not.toBe(0);
    expect(withEpic.stderr).toMatch(/unknown option '--epic'/);
  });

  it("lists the same project/epic/story scopes as tree via --in and omits for all", async () => {
    const projectList = JSON.parse((await runIssueCli(["list", "--in", "p"], { env: env() })).stdout);
    expect(projectList.issues.map((i: { id: string }) => i.id).sort()).toEqual(
      ["a", "b", "c1", "e", "p"],
    );

    const epicList = JSON.parse((await runIssueCli(["list", "--in", "e"], { env: env() })).stdout);
    expect(epicList.issues.map((i: { id: string }) => i.id).sort()).toEqual(
      ["a", "b", "c1", "e"],
    );

    const storyList = JSON.parse((await runIssueCli(["list", "--in", "a"], { env: env() })).stdout);
    expect(storyList.issues.map((i: { id: string }) => i.id).sort()).toEqual(
      ["a", "c1"],
    );

    const all = JSON.parse((await runIssueCli(["list"], { env: env() })).stdout);
    expect(all.issues.map((i: { id: string }) => i.id).sort()).toEqual(
      ["a", "b", "c1", "e", "p"],
    );

    const taskList = await runIssueCli(["list", "--in", "c1"], { env: env() });
    expect(taskList.status).toBe(1);
    expect(taskList.stderr).toContain("cannot scope list to a task");
  });

  it("filters by kind positional combined with --in scope", async () => {
    const listed = JSON.parse((await runIssueCli(["list", "story", "--in", "p"], { env: env() })).stdout);
    const ids = listed.issues.map((i: { id: string }) => i.id).sort();
    expect(ids).toEqual(["a", "b"]);
    for (const id of ids) {
      expect(listed.issues.find((i: { id: string }) => i.id === id)?.kind).toBe(
        "story",
      );
      expect(listed.derived[id]).toBeDefined();
    }
  });

  it("combines kind filter with epic and story --in anchors on unarchived fixtures", async () => {
    const storiesInEpicRun = await runIssueCli(["list", "story", "--in", "e"], { env: env() });
    expect(storiesInEpicRun.status).toBe(0);
    const storiesInEpic = JSON.parse(storiesInEpicRun.stdout);
    expect(storiesInEpic.issues.map((i: { id: string }) => i.id).sort()).toEqual(
      ["a", "b"],
    );
    for (const issue of storiesInEpic.issues) {
      expect(issue.kind).toBe("story");
      expect(storiesInEpic.derived[issue.id]).toBeDefined();
    }

    const tasksInStoryRun = await runIssueCli(["list", "task", "--in", "a"], { env: env() });
    expect(tasksInStoryRun.status).toBe(0);
    const tasksInStory = JSON.parse(tasksInStoryRun.stdout);
    expect(tasksInStory.issues.map((i: { id: string }) => i.id)).toEqual(["c1"]);
    expect(tasksInStory.issues[0].kind).toBe("task");
    expect(tasksInStory.derived.c1).toBeDefined();
  });

  it("returns every kind in scope with --in only", async () => {
    const listed = JSON.parse((await runIssueCli(["list", "--in", "p"], { env: env() })).stdout);
    const kinds = new Set(listed.issues.map((i: { kind: string }) => i.kind));
    expect(kinds).toEqual(new Set(["project", "epic", "story", "task"]));
  });

  it("spans all projects when scope and kind are omitted", async () => {
    writeIssue("p2", {
      kind: "project",
      title: "Other",
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    const listed = JSON.parse((await runIssueCli(["list"], { env: env() })).stdout);
    const projectIds = listed.issues
      .filter((i: { kind: string }) => i.kind === "project")
      .map((i: { id: string }) => i.id)
      .sort();
    expect(projectIds).toEqual(["p", "p2"]);
  });

  it("refuses --in with an idea or task id", async () => {
    writeIssue("idea-x", {
      kind: "idea",
      title: "Capture",
      partOf: "p",
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    const ideaScope = await runIssueCli(["list", "--in", "idea-x"], { env: env() });
    expect(ideaScope.status).toBe(1);
    expect(ideaScope.stderr).toContain("cannot scope list to an idea");

    const taskScope = await runIssueCli(["list", "--in", "c1"], { env: env() });
    expect(taskScope.status).toBe(1);
    expect(taskScope.stderr).toContain("cannot scope list to a task");
  });

  it("errors on a non-kind positional with teaching message", async () => {
    const bad = await runIssueCli(["list", "p"], { env: env() });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain(
      'unknown kind "p"; to scope by container use: issue list --in p',
    );
  });

  it("describes output shape in --help", async () => {
    const help = await runIssueCli(["list", "--help"], { env: env() });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("issues");
    expect(help.stdout).toContain("derived");
    expect(help.stdout).toContain("problems");
    expect(help.stdout).toContain("keyed by issue id");
    expect(help.stdout).toContain("blocked");
    expect(help.stdout).toContain("storyStatus");
    expect(help.stdout).toContain("epicStatus");
    expect(help.stdout).toContain("ideaStatus");
    expect(help.stdout).toContain("mergeBase");
    expect(help.stdout).toContain("mergePolicy");
    expect(help.stdout).toContain("reviewCurrent");
  });

  it("shows review and retro chips on the correct lines only when set", async () => {
    const unset = await runIssueCli(["tree", "p"], { env: env() });
    expect(unset.status).toBe(0);
    expect(unset.stdout).not.toMatch(/^ {2}epic e\b.*\bretro=/m);
    expect(unset.stdout).not.toMatch(/^ {4}story a\b.*\breview=/m);
    expect(unset.stdout).not.toMatch(/^ {4}story a\b.*\bretro=/m);

    expect((await runIssueCli(["epic", "set", "e", "retro", "in-progress"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["story", "set", "a", "review", "passed"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["story", "set", "a", "retro", "done"], { env: env() })).status).toBe(0);

    const set = await runIssueCli(["tree", "p"], { env: env() });
    expect(set.status).toBe(0);
    expect(set.stdout).toMatch(/^ {2}epic e\b.*\bretro=in-progress\b/m);
    expect(set.stdout).toMatch(/^ {4}story a\b.*\breview=passed\b/m);
    expect(set.stdout).toMatch(/^ {4}story a\b.*\bretro=done\b/m);

    expect((await runIssueCli(["epic", "set", "e", "retro", "--clear"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["story", "set", "a", "retro", "--clear"], { env: env() })).status).toBe(0);

    const cleared = await runIssueCli(["tree", "p"], { env: env() });
    expect(cleared.status).toBe(0);
    expect(cleared.stdout).not.toMatch(/^ {2}epic e\b.*\bretro=/m);
    expect(cleared.stdout).not.toMatch(/^ {4}story a\b.*\bretro=/m);
    expect(cleared.stdout).toMatch(/^ {4}story a\b.*\breview=passed\b/m);
  });

  it("shows review stale chip when coverage is out of date and never reviewedTasks", async () => {
    expect((await runIssueCli(["story", "set", "a", "branchName", "feat/a"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["task", "set", "c1", "status", "done"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["story", "set", "a", "review", "passed"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["story", "set", "a", "reviewedTasks", '["c1"]'], { env: env() })).status).toBe(0);

    const current = await runIssueCli(["tree", "p"], { env: env() });
    expect(current.status).toBe(0);
    expect(current.stdout).toMatch(/^ {4}story a\b.*\breview=passed\b/m);
    expect(current.stdout).not.toMatch(/^ {4}story a\b.*\bstale\b/m);
    expect(current.stdout).not.toMatch(/^ {4}story a\b.*\breviewedTasks=/m);

    writeIssue("c2", {
      kind: "task",
      title: "C2",
      partOf: "a",
      status: "done",
      order: 1,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });

    const stale = await runIssueCli(["tree", "p"], { env: env() });
    expect(stale.status).toBe(0);
    expect(stale.stdout).toMatch(/^ {4}story a\b.*\breview=passed\b.*\bstale\b/m);
    expect(stale.stdout).not.toMatch(/\breviewedTasks=/m);

    expect((await runIssueCli(["task", "set", "c1", "status", "in-progress"], { env: env() })).status).toBe(0);

    const rework = await runIssueCli(["tree", "p"], { env: env() });
    expect(rework.status).toBe(0);
    expect(rework.stdout).toMatch(/^ {4}story a\b.*\breview=passed\b.*\bstale\b/m);
  });

  it("shows needsRebase chip on story lines only when set", async () => {
    const unset = await runIssueCli(["tree", "p"], { env: env() });
    expect(unset.status).toBe(0);
    expect(unset.stdout).not.toMatch(/^ {4}story a\b.*\bneedsRebase=/m);

    expect((await runIssueCli(["story", "set", "a", "needsRebase", "feat/base"], { env: env() })).status).toBe(0);

    const set = await runIssueCli(["tree", "p"], { env: env() });
    expect(set.status).toBe(0);
    expect(set.stdout).toMatch(/^ {4}story a\b.*\bneedsRebase=feat\/base\b/m);

    expect((await runIssueCli(["story", "set", "a", "needsRebase", "--clear"], { env: env() })).status).toBe(0);

    const cleared = await runIssueCli(["tree", "p"], { env: env() });
    expect(cleared.status).toBe(0);
    expect(cleared.stdout).not.toMatch(/^ {4}story a\b.*\bneedsRebase=/m);
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

describe("deleted field verbs", () => {
  it("are unknown commands and absent from top-level --help", async () => {
    const help = await runIssueCli(["--help"], { env: env() });
    expect(help.status).toBe(0);

    for (const verb of DELETED_FIELD_VERBS) {
      const { stderr, status } = await runIssueCli([verb], { env: env() });
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
    "projects",
  ];

  it("are unknown commands and absent from top-level --help", async () => {
    const help = await runIssueCli(["--help"], { env: env() });
    expect(help.status).toBe(0);

    for (const verb of LEGACY_COMMANDS) {
      const { stderr, status } = await runIssueCli([verb], { env: env() });
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
      expect(stdout, kind).toContain(`commented on ${id}`);
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
      JSON.stringify({ role: "agent", name: "bot", body: "first note", at: nextAt() }) +
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
    expect(bare.stdout).toBe("commented on a as impl\n");

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
    expect(scoped.stdout).toBe("commented on a as impl\n");

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
