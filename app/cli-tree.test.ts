import { readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { runIssueCli } from "./cli-program.js";
import {
  dir,
  env,
  makeGitWorkspace,
  nextAt,
  useCliTestFixtures,
  writeIssue,
} from "./cli.test-helpers.js";

useCliTestFixtures();

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
      JSON.stringify({ id: "c1", role: "agent", name: "bot", body: "first note", at: nextAt() }) + "\n",
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

  it("prints setupCommand when set on a project", async () => {
    const cmd = "npm ci";
    expect((await runIssueCli(["project", "set", "p", "setupCommand", cmd], { env: env() })).status).toBe(0);
    const { stdout, status } = await runIssueCli(["project", "view", "p"], { env: env() });
    expect(status).toBe(0);
    expect(stdout).toContain(`setupCommand: ${cmd}`);
  });

  it("omits setupCommand when unset on a project", async () => {
    const { stdout, status } = await runIssueCli(["project", "view", "p"], { env: env() });
    expect(status).toBe(0);
    expect(stdout).not.toContain("setupCommand:");
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
