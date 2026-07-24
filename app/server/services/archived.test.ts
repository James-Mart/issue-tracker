import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ancestorIsArchived,
  planArchivedCascade,
  visibleIssues,
} from "./archived.js";
import type { Issue } from "../schemas.js";

const AT = "2026-07-09T14:00:00.000Z";

function project(id: string): Issue {
  return {
    id,
    kind: "project",
    title: id,
    mergePolicy: "manual",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  };
}

function epic(
  id: string,
  partOf: string,
  overrides: Partial<Extract<Issue, { kind: "epic" }>> = {},
): Issue {
  return {
    id,
    kind: "epic",
    title: id,
    partOf,
    blockedBy: [],
    needsAttention: false,
    attentionReason: null,
    archived: false,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

function branch(
  id: string,
  partOf: string,
  overrides: Partial<Extract<Issue, { kind: "story" }>> = {},
): Issue {
  return {
    id,
    kind: "story",
    title: id,
    partOf,
    merged: false,
    needsAttention: false,
    attentionReason: null,
    archived: false,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

function commit(
  id: string,
  partOf: string,
  overrides: Partial<Extract<Issue, { kind: "task" }>> = {},
): Issue {
  return {
    id,
    kind: "task",
    title: id,
    partOf,
    status: "todo",
    needsAttention: false,
    attentionReason: null,
    archived: false,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

describe("planArchivedCascade", () => {
  const issues = [
    project("p"),
    epic("e", "p"),
    branch("b", "e"),
    commit("c", "b"),
    branch("b2", "e", { archived: true }),
  ];

  it("plans the same archived value for every partOf descendant", () => {
    expect(
      planArchivedCascade(issues[1]!, { archived: true }, issues),
    ).toEqual([
      { id: "b", archived: true },
      { id: "c", archived: true },
    ]);
  });

  it("cascades unarchive to descendants", () => {
    const archivedTree = [
      project("p"),
      epic("e", "p", { archived: true }),
      branch("b", "e", { archived: true }),
      commit("c", "b", { archived: true }),
    ];
    expect(
      planArchivedCascade(archivedTree[1]!, { archived: false }, archivedTree),
    ).toEqual([
      { id: "b", archived: false },
      { id: "c", archived: false },
    ]);
  });

  it("is a no-op when archived is not in the patch", () => {
    expect(planArchivedCascade(issues[1]!, { title: "x" }, issues)).toEqual([]);
  });

  it("allows independent child archive without touching siblings", () => {
    expect(
      planArchivedCascade(issues[2]!, { archived: true }, issues),
    ).toEqual([{ id: "c", archived: true }]);
  });
});

describe("ancestorIsArchived", () => {
  it("detects an archived epic ancestor", () => {
    const issues = [
      project("p"),
      epic("e", "p", { archived: true }),
      branch("b", "e"),
    ];
    expect(ancestorIsArchived("e", issues)).toBe(true);
    expect(ancestorIsArchived("p", issues)).toBe(false);
  });

  it("detects an archived branch when creating a commit", () => {
    const issues = [
      project("p"),
      epic("e", "p"),
      branch("b", "e", { archived: true }),
    ];
    expect(ancestorIsArchived("b", issues)).toBe(true);
  });
});

describe("visibleIssues", () => {
  it("omits archived rows unless showArchived", () => {
    const issues = [
      project("p"),
      epic("e", "p", { archived: true }),
      branch("b", "e"),
    ];
    expect(visibleIssues(issues, false).map((i) => i.id)).toEqual(["p", "b"]);
    expect(visibleIssues(issues, true).map((i) => i.id)).toEqual([
      "p",
      "e",
      "b",
    ]);
  });
});

describe("archived on-disk (migration + cascade/create)", () => {
  let dir: string;

  function writeIssue(id: string, body: Record<string, unknown>): void {
    mkdirSync(join(dir, id), { recursive: true });
    writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
  }

  function readIssue(id: string): Record<string, unknown> {
    return JSON.parse(readFileSync(join(dir, id, "issue.json"), "utf8"));
  }

  function seedTree(opts: { withArchivedDefaults?: boolean } = {}): void {
    const defaults = opts.withArchivedDefaults
      ? {
          needsAttention: false,
          attentionReason: null,
          archived: false,
        }
      : {};
    writeIssue("p", {
      kind: "project",
      title: "P",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("e", {
      kind: "epic",
      title: "E",
      partOf: "p",
      blockedBy: [],
      order: 0,
      createdAt: AT,
      updatedAt: AT,
      ...defaults,
    });
    writeIssue("b", {
      kind: "story",
      title: "B",
      partOf: "e",
      merged: false,
      order: 0,
      createdAt: AT,
      updatedAt: AT,
      ...defaults,
    });
    writeIssue("c", {
      kind: "task",
      title: "C",
      partOf: "b",
      status: "todo",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
      ...defaults,
    });
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "issue-tracker-archived-"));
    vi.resetModules();
    vi.stubEnv("ISSUES_DIR", dir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it("materializes archived: false on epic/branch/commit once", async () => {
    seedTree();
    const { list } = await import("./issues.js");
    list();

    expect(readIssue("e").archived).toBe(false);
    expect(readIssue("b").archived).toBe(false);
    expect(readIssue("c").archived).toBe(false);
    expect("archived" in readIssue("p")).toBe(false);

    writeIssue("e", { ...readIssue("e"), archived: true });
    list();
    expect(readIssue("e").archived).toBe(true);
  });

  it("cascades archive and unarchive through descendants", async () => {
    seedTree({ withArchivedDefaults: true });
    const { update } = await import("./issues.js");
    await update("e", { archived: true });
    expect(readIssue("e").archived).toBe(true);
    expect(readIssue("b").archived).toBe(true);
    expect(readIssue("c").archived).toBe(true);

    await update("e", { archived: false });
    expect(readIssue("e").archived).toBe(false);
    expect(readIssue("b").archived).toBe(false);
    expect(readIssue("c").archived).toBe(false);
  });

  it("creates a child under an archived parent as archived", async () => {
    seedTree({ withArchivedDefaults: true });
    const { update, create } = await import("./issues.js");
    await update("e", { archived: true });
    const child = await create({
      kind: "story",
      title: "New Branch",
      partOf: "e",
    });
    expect(child.kind === "story" && child.archived).toBe(true);
    expect(readIssue(child.id).archived).toBe(true);
  });

  it("allows archiving a child while the parent stays unarchived", async () => {
    seedTree({ withArchivedDefaults: true });
    const { update } = await import("./issues.js");
    await update("b", { archived: true });
    expect(readIssue("b").archived).toBe(true);
    expect(readIssue("c").archived).toBe(true);
    expect(readIssue("e").archived).toBe(false);
  });
});
