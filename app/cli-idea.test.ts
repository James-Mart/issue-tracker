import { readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { runIssueCli } from "./cli-program.js";
import {
  conversationsRoot,
  dir,
  env,
  issueJsonField,
  nextAt,
  seedPlanningSession,
  useCliTestFixtures,
  writeIssue,
} from "./cli.test-helpers.js";

useCliTestFixtures();

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

  it("sets, gets, and clears appendTo on an idea", async () => {
    writeIssue("target-story", {
      kind: "story",
      title: "Target",
      partOf: "p",
      order: 1,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    expect((await runIssueCli(["idea", "add", "--part-of", "p", "Append me"], { env: env() })).status).toBe(0);

    expect((await runIssueCli(["idea", "get", "append-me", "appendTo"], { env: env() })).stdout).toBe("");
    expect(
      (await runIssueCli(["idea", "set", "append-me", "appendTo", "target-story"], { env: env() })).status,
    ).toBe(0);
    expect((await runIssueCli(["idea", "get", "append-me", "appendTo"], { env: env() })).stdout).toBe(
      "target-story\n",
    );

    const view = await runIssueCli(["idea", "view", "append-me"], { env: env() });
    expect(view.status).toBe(0);
    expect(view.stdout).toMatch(/^appendTo: target-story$/m);

    expect(
      (await runIssueCli(["idea", "set", "append-me", "appendTo", "--clear"], { env: env() })).status,
    ).toBe(0);
    expect((await runIssueCli(["idea", "get", "append-me", "appendTo"], { env: env() })).stdout).toBe("");
  });

  it("refuses appendTo with distinct validation messages", async () => {
    writeIssue("merged-target", {
      kind: "story",
      title: "Merged",
      partOf: "p",
      order: 1,
      merged: true,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    expect((await runIssueCli(["idea", "add", "--part-of", "p", "Bad targets"], { env: env() })).status).toBe(0);

    const missing = await runIssueCli(["idea", "set", "bad-targets", "appendTo", "ghost"], { env: env() });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toMatch(/names nothing in this Project/);

    const wrongKind = await runIssueCli(["idea", "set", "bad-targets", "appendTo", "e"], { env: env() });
    expect(wrongKind.status).toBe(1);
    expect(wrongKind.stderr).toMatch(/append targets are Stories/);

    const merged = await runIssueCli(["idea", "set", "bad-targets", "appendTo", "merged-target"], {
      env: env(),
    });
    expect(merged.status).toBe(1);
    expect(merged.stderr).toMatch(/cannot target merged Story/);
  });

  it("gets and sets approvePlan", async () => {
    expect((await runIssueCli(["idea", "add", "--part-of", "p", "Gate me"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["idea", "get", "gate-me", "approvePlan"], { env: env() })).stdout).toBe("");
    expect((await runIssueCli(["idea", "set", "gate-me", "approvePlan", "true"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["idea", "get", "gate-me", "approvePlan"], { env: env() })).stdout).toBe("true\n");
  });

  it("gets and sets approvalPending", async () => {
    expect((await runIssueCli(["idea", "add", "--part-of", "p", "Gate pending"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["idea", "get", "gate-pending", "approvalPending"], { env: env() })).stdout).toBe("");
    expect((await runIssueCli(["idea", "set", "gate-pending", "approvalPending", "true"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["idea", "get", "gate-pending", "approvalPending"], { env: env() })).stdout).toBe("true\n");
    expect((await runIssueCli(["idea", "set", "gate-pending", "approvalPending", "false"], { env: env() })).status).toBe(0);
    expect((await runIssueCli(["idea", "get", "gate-pending", "approvalPending"], { env: env() })).stdout).toBe("");
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
