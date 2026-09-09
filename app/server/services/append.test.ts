import { existsSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import type { ApplyDoc, StoryApplyDoc } from "./apply-schema.js";
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
    status: "fixing",
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
  it("leaves unmentioned Tasks untouched and appends new ones at the tail", async () => {
    seedStory();
    const { appendTasks, list } = await loadAppend();

    const summary = await appendTasks({
      storyId: "s1",
      doc: storyDoc([
        { kind: "task", id: "new-a", title: "New A" },
        { kind: "task", id: "new-b", title: "New B" },
      ]),
    });

    expect(summary.created).toEqual(["new-a", "new-b"]);
    expect(summary.updated).toEqual([]);
    expect(existsSync(join(dir, "keep-me"))).toBe(true);

    const keep = readIssue("keep-me");
    expect(keep.title).toBe("Keep me");
    expect(keep.status).toBe("done");
    expect(keep.commits).toEqual([SHA]);
    expect(keep.order).toBe(0);
    expect(keep.appended).toBeUndefined();

    expect(readIssue("new-a").order).toBe(3);
    expect(readIssue("new-b").order).toBe(4);
    expect(readIssue("new-a").appended).toBe(true);
    expect(readIssue("new-b").appended).toBe(true);
    expect(readIssue("restated").appended).toBeUndefined();
    expect(list().problems).toEqual([]);
  });

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
    expect(restated.status).toBe("fixing");
    expect(restated.commits).toEqual([SHA]);
    expect(restated.order).toBe(2);
    expect(restated.appended).toBeUndefined();
    expect(readIssue("keep-me").title).toBe("Keep me");
    expect(readIssue("new-c").order).toBe(3);
  });

  it("preserves appended across a later apply of the Story's task list", async () => {
    seedStory();
    const { appendTasks, apply } = await loadAppend();

    await appendTasks({
      storyId: "s1",
      doc: storyDoc([{ kind: "task", id: "appended-later", title: "Appended" }]),
    });
    expect(readIssue("appended-later").appended).toBe(true);

    await apply(
      storyDoc([
        { kind: "task", id: "keep-me", title: "Keep me" },
        { kind: "task", id: "restated", title: "Restated" },
        { kind: "task", id: "appended-later", title: "Appended renamed" },
      ]),
    );

    const kept = readIssue("appended-later");
    expect(kept.title).toBe("Appended renamed");
    expect(kept.appended).toBe(true);
    expect(readIssue("keep-me").appended).toBeUndefined();
  });

  it("refuses a merged target with the append-target reason", async () => {
    seedStory({ merged: true });
    const { appendTasks } = await loadAppend();

    await expect(
      appendTasks({
        storyId: "s1",
        doc: storyDoc([{ kind: "task", id: "nope", title: "Nope" }]),
      }),
    ).rejects.toThrow(/appendTo cannot target merged Story "s1"/);
    expect(existsSync(join(dir, "nope"))).toBe(false);
  });

  it("refuses when the doc story.id disagrees with the argument", async () => {
    seedStory();
    const { appendTasks } = await loadAppend();

    await expect(
      appendTasks({
        storyId: "s1",
        doc: storyDoc([{ kind: "task", id: "nope", title: "Nope" }], "other"),
      }),
    ).rejects.toThrow(/story.id "other" does not match append target "s1"/);
    expect(existsSync(join(dir, "nope"))).toBe(false);
  });

  it("refuses kind: story children", async () => {
    seedStory();
    const { appendTasks } = await loadAppend();

    const doc = {
      project: "p1",
      epic: "e1",
      story: {
        id: "s1",
        title: "Story",
        children: [{ kind: "story", id: "stacked", title: "Stacked" }],
      },
    } as ApplyDoc;

    await expect(appendTasks({ storyId: "s1", doc })).rejects.toThrow(
      /stacked Story is not an append/,
    );
    expect(existsSync(join(dir, "stacked"))).toBe(false);
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
