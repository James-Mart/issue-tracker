import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-07-09T14:00:00.000Z";
let dir: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function readRaw(id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, id, "issue.json"), "utf8"));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-code-gate-merge-policy-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

async function loadService() {
  return import("./issues.js");
}

function seedCodeGateArchiveFixtures(): void {
  writeIssue("p", {
    kind: "project",
    title: "P",
    order: 0,
    mergePolicy: "merge",
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("idea", {
    kind: "idea",
    title: "Idea",
    partOf: "p",
    order: 0,
    archived: false,
    codeApprovalRequired: true,
    createdAt: AT,
    updatedAt: AT,
  });
}

describe("code-gate merge policy lowering on Idea archive", () => {
  it("lowers a merge Project Epic root to manual on archive", async () => {
    seedCodeGateArchiveFixtures();
    writeIssue("epic", {
      kind: "epic",
      title: "Epic",
      partOf: "p",
      order: 1,
      sourceIdea: "idea",
      createdAt: AT,
      updatedAt: AT,
    });

    const { update, read, list } = await loadService();
    await update("idea", { archived: true });

    expect(readRaw("idea").archived).toBe(true);
    expect(readRaw("epic").mergePolicy).toBe("manual");
    expect(read("epic").kind === "epic" && read("epic").mergePolicy).toBe("manual");
    expect(list().derived.epic?.mergePolicy).toBe("manual");
    expect(readRaw("p").mergePolicy).toBe("merge");
  });

  it("lowers a pull-request root Story to manual on archive", async () => {
    writeIssue("p", {
      kind: "project",
      title: "P",
      order: 0,
      mergePolicy: "pull-request",
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("idea", {
      kind: "idea",
      title: "Idea",
      partOf: "p",
      order: 0,
      archived: false,
      codeApprovalRequired: true,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("story", {
      kind: "story",
      title: "Story",
      partOf: "p",
      order: 1,
      merged: false,
      sourceIdea: "idea",
      createdAt: AT,
      updatedAt: AT,
    });

    const { update, list } = await loadService();
    await update("idea", { archived: true });

    expect(readRaw("story").mergePolicy).toBe("manual");
    expect(list().derived.story?.mergePolicy).toBe("manual");
  });

  it("leaves a manual root without a stored override", async () => {
    writeIssue("p", {
      kind: "project",
      title: "P",
      order: 0,
      mergePolicy: "manual",
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("idea", {
      kind: "idea",
      title: "Idea",
      partOf: "p",
      order: 0,
      archived: false,
      codeApprovalRequired: true,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("epic", {
      kind: "epic",
      title: "Epic",
      partOf: "p",
      order: 1,
      sourceIdea: "idea",
      createdAt: AT,
      updatedAt: AT,
    });

    const { update, list } = await loadService();
    await update("idea", { archived: true });

    expect(readRaw("idea").archived).toBe(true);
    expect(readRaw("epic")).not.toHaveProperty("mergePolicy");
    expect(list().derived.epic?.mergePolicy).toBe("manual");
  });

  it("lowers explicit merge-policy descendants under a plan root on archive", async () => {
    seedCodeGateArchiveFixtures();
    writeIssue("epic", {
      kind: "epic",
      title: "Epic",
      partOf: "p",
      order: 1,
      sourceIdea: "idea",
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("story", {
      kind: "story",
      title: "Story",
      partOf: "epic",
      order: 0,
      merged: false,
      mergePolicy: "merge",
      createdAt: AT,
      updatedAt: AT,
    });

    const { update, list } = await loadService();
    await update("idea", { archived: true });

    expect(readRaw("epic").mergePolicy).toBe("manual");
    expect(readRaw("story").mergePolicy).toBe("manual");
    expect(list().derived.story?.mergePolicy).toBe("manual");
  });

  it("does not lower plan roots when codeApprovalRequired is unset", async () => {
    seedCodeGateArchiveFixtures();
    writeIssue("epic", {
      kind: "epic",
      title: "Epic",
      partOf: "p",
      order: 1,
      sourceIdea: "idea",
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("idea", {
      ...readRaw("idea"),
      codeApprovalRequired: undefined,
    });

    const { update, list } = await loadService();
    await update("idea", { archived: true });

    expect(readRaw("idea").archived).toBe(true);
    expect(readRaw("epic")).not.toHaveProperty("mergePolicy");
    expect(list().derived.epic?.mergePolicy).toBe("merge");
  });

  it("leaves the Idea unarchived and every root untouched when the write batch fails", async () => {
    seedCodeGateArchiveFixtures();
    writeIssue("epic", {
      kind: "epic",
      title: "Epic",
      partOf: "p",
      order: 1,
      sourceIdea: "idea",
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("story", {
      kind: "story",
      title: "Story",
      partOf: "p",
      order: 2,
      merged: false,
      sourceIdea: "idea",
      mergePolicy: "merge",
      createdAt: AT,
      updatedAt: AT,
    });

    const before = {
      idea: readRaw("idea"),
      epic: readRaw("epic"),
      story: readRaw("story"),
    };

    vi.stubEnv("ISSUE_TRACKER_STORE_READ_ONLY", "1");
    vi.resetModules();
    const { update } = await loadService();

    await expect(update("idea", { archived: true })).rejects.toMatchObject({
      code: "read_only",
    });

    expect(readRaw("idea")).toEqual(before.idea);
    expect(readRaw("epic")).toEqual(before.epic);
    expect(readRaw("story")).toEqual(before.story);
  });
});
