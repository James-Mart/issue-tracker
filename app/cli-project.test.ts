import { rmSync, writeFileSync } from "fs";
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
