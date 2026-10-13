import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { runIssueCli } from "./cli-program.js";
import { dir, env, nextAt, useCliTestFixtures, writeIssue } from "./cli.test-helpers.js";

useCliTestFixtures();

function readJson(id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, id, "issue.json"), "utf8"));
}

function seedStory(id: string, merged: boolean): void {
  writeIssue(id, {
    kind: "story",
    title: `Story ${id}`,
    partOf: "p",
    merged,
    order: Number(id.replace(/\D/g, "")),
    createdAt: nextAt(),
    updatedAt: nextAt(),
  });
}

function writeRecord(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, "p", "reviews"), { recursive: true });
  writeFileSync(
    join(dir, "p", "reviews", `${id}.json`),
    JSON.stringify({
      id,
      projectId: "p",
      createdAt: nextAt(),
      updatedAt: nextAt(),
      marks: { all: {}, commits: {} },
      ...body,
    }),
  );
}

describe("review record migration", () => {
  it("turns every record into a review issue with the same id and removes the record store", async () => {
    writeIssue("p", { kind: "project", title: "P", order: 0, createdAt: nextAt(), updatedAt: nextAt() });
    seedStory("s1", false);
    seedStory("s2", true);
    seedStory("s3", true);
    seedStory("s4", false);
    const submission = {
      id: "sub-1",
      at: nextAt(),
      threadIds: ["c1"],
      status: "done",
      taskIds: ["t1"],
    };
    writeRecord("r-open", {
      target: { kind: "story", storyId: "s1" },
      status: "open",
      postMortem: false,
      submissions: [submission],
    });
    writeRecord("r-merged", {
      target: { kind: "story", storyId: "s2" },
      status: "open",
      postMortem: false,
    });
    writeRecord("r-post-mortem", {
      target: { kind: "story", storyId: "s3" },
      status: "open",
      postMortem: true,
    });
    writeRecord("r-archived", {
      target: { kind: "story", storyId: "s4" },
      status: "archived",
      postMortem: false,
    });

    const listed = await runIssueCli(["list", "review", "--show-archived"], { env: env() });
    expect(listed.status).toBe(0);
    expect(JSON.parse(listed.stdout).problems).toEqual([]);

    expect(readJson("r-open")).toMatchObject({
      kind: "review",
      partOf: "p",
      title: "Story s1",
      story: "s1",
      archived: false,
      submissions: [submission],
    });
    expect(readJson("r-merged")).toMatchObject({ story: "s2", archived: true, submissions: [] });
    expect(readJson("r-post-mortem")).toMatchObject({ story: "s3", archived: false });
    expect(readJson("r-archived")).toMatchObject({ story: "s4", archived: true });
    const orders = ["r-open", "r-merged", "r-post-mortem", "r-archived"].map(
      (id) => readJson(id).order,
    );
    expect(new Set(orders).size).toBe(4);
    expect(existsSync(join(dir, "p", "reviews"))).toBe(false);
    expect(existsSync(join(dir, ".review-records-migrated"))).toBe(true);
  });

  it("omits review issues from the default tree and still lists them by kind", async () => {
    writeIssue("p", {
      kind: "project",
      title: "P",
      order: 0,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    seedStory("s1", false);
    writeIssue("r-open", {
      kind: "review",
      title: "Story s1",
      partOf: "p",
      story: "s1",
      archived: false,
      order: 0,
      marks: { all: {}, commits: {} },
      submissions: [],
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });

    const tree = await runIssueCli(["tree"], { env: env() });
    expect(tree.status).toBe(0);
    expect(tree.stdout).toContain("story s1");
    expect(tree.stdout).not.toContain("r-open");

    const listed = await runIssueCli(["list", "review"], { env: env() });
    expect(listed.status).toBe(0);
    const ids = JSON.parse(listed.stdout).issues.map((issue: { id: string }) => issue.id);
    expect(ids).toContain("r-open");
  });
});
