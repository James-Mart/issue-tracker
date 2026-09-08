import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { runIssueCli } from "./cli-program.js";
import { DELETED_FIELD_VERBS } from "./deleted-field-verbs.js";
import {
  dir,
  env,
  issueJsonField,
  nextAt,
  runCliWithEarlyStdoutClose,
  spawnCliColdBoot,
  useCliTestFixtures,
  writeIssue,
} from "./cli.test-helpers.js";

useCliTestFixtures();

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

describe("kind-scoped add", () => {
  beforeEach(() => {
    writeIssue("p", { kind: "project", title: "Proj", createdAt: nextAt(), updatedAt: nextAt() });
  });

  it("adds a project and prints its id", async () => {
    const { stdout, status } = await runIssueCli(["project", "add", "New Project"], { env: env() });
    expect(status).toBe(0);
    const id = stdout.trim();
    expect(id).toBe("new-project");
    expect(issueJsonField(id, "kind")).toBe("project");
    expect(issueJsonField(id, "title")).toBe("New Project");
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

    const help = await runIssueCli(["project", "add", "--help"], { env: env() });
    expect(help.status).toBe(0);
    expect(help.stdout).toMatch(/--file <path>/);
    expect(help.stdout).not.toMatch(/--description[_-]file/);
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
