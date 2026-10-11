import { existsSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import type { StoryApplyDoc } from "./apply-schema.js";
import {
  AT,
  dir,
  readIssue,
  snapshot,
  useApplyTestFixtures,
  writeIssue,
} from "./apply.test-fixtures.js";

useApplyTestFixtures();

const SHA = "deadbeef00000000000000000000000000000000";

async function loadAppend() {
  const { appendTasks } = await import("./append.js");
  const { apply } = await import("./apply.js");
  const issues = await import("./issues.js");
  return { appendTasks, apply, ...issues };
}

function seedStory(opts?: { merged?: boolean }): void {
  writeIssue("p1", { kind: "project", title: "P1", createdAt: AT, updatedAt: AT });
  writeIssue("e1", {
    kind: "epic",
    title: "E1",
    partOf: "p1",
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("s1", {
    kind: "story",
    title: "Story",
    partOf: "e1",
    merged: opts?.merged ?? false,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("keep-me", {
    kind: "task",
    title: "Keep me",
    partOf: "s1",
    status: "done",
    commits: [SHA],
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("restated", {
    kind: "task",
    title: "Restated",
    partOf: "s1",
    status: "in-progress",
    commits: [SHA],
    order: 2,
    createdAt: AT,
    updatedAt: AT,
  });
}

function storyDoc(
  children: StoryApplyDoc["story"]["children"],
  storyId = "s1",
): StoryApplyDoc {
  return {
    project: "p1",
    epic: "e1",
    story: {
      id: storyId,
      title: "Story",
      children,
    },
  };
}

describe("appendTasks", () => {
  it("upserts a restated Task in place, keeping status, commits, and order", async () => {
    seedStory();
    const { appendTasks } = await loadAppend();

    const summary = await appendTasks({
      storyId: "s1",
      doc: storyDoc([
        { kind: "task", id: "restated", title: "Restated renamed" },
        { kind: "task", id: "new-c", title: "New C" },
      ]),
    });

    expect(summary.created).toEqual(["new-c"]);
    expect(summary.updated).toEqual(["restated"]);

    const restated = readIssue("restated");
    expect(restated.title).toBe("Restated renamed");
    expect(restated.status).toBe("in-progress");
    expect(restated.commits).toEqual([SHA]);
    expect(restated.order).toBe(2);
    expect(restated.appended).toBeUndefined();
    expect(readIssue("keep-me").title).toBe("Keep me");
    expect(readIssue("new-c").order).toBe(3);
  });

  it("makes no partial writes when one node would break integrity", async () => {
    seedStory();
    writeIssue("taken", {
      kind: "epic",
      title: "Taken",
      partOf: "p1",
      createdAt: AT,
      updatedAt: AT,
    });
    const { appendTasks, ensureMigrations } = await loadAppend();
    ensureMigrations();
    const before = snapshot();

    await expect(
      appendTasks({
        storyId: "s1",
        doc: storyDoc([
          { kind: "task", id: "valid-new", title: "Valid new" },
          { kind: "task", id: "taken", title: "Collision" },
        ]),
      }),
    ).rejects.toThrow(/already exists outside the target story "s1"/);

    expect(existsSync(join(dir, "valid-new"))).toBe(false);
    expect(snapshot()).toBe(before);
  });
});
