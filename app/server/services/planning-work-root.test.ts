import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let issuesRoot: string;

function writeIssue(
  id: string,
  body: Record<string, unknown>,
  description?: string,
): void {
  const dir = join(issuesRoot, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "issue.json"), JSON.stringify({ id, ...body }));
  if (description !== undefined) {
    writeFileSync(join(dir, "description.md"), description);
  }
}

beforeEach(() => {
  issuesRoot = mkdtempSync(join(tmpdir(), "planning-work-root-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesRoot);
});

afterEach(() => {
  rmSync(issuesRoot, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("descriptionBacklinksIdea", () => {
  it("matches a Source idea markdown link", async () => {
    const { descriptionBacklinksIdea } = await import("./planning-work-root.js");
    expect(
      descriptionBacklinksIdea(
        "Source idea: [Capture](issue:capture)\n\nPlan body.",
        "capture",
      ),
    ).toBe(true);
  });

  it("does not match a different idea id", async () => {
    const { descriptionBacklinksIdea } = await import("./planning-work-root.js");
    expect(
      descriptionBacklinksIdea(
        "Source idea: [Other](issue:other)\n",
        "capture",
      ),
    ).toBe(false);
  });
});

describe("findPlanningWorkRoot", () => {
  it("returns an Epic whose description backlinks the Idea", async () => {
    writeIssue("platform", {
      kind: "project",
      title: "Platform",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });
    writeIssue("capture", {
      kind: "idea",
      title: "Capture",
      partOf: "platform",
      order: 0,
      archived: false,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });
    writeIssue(
      "ship-it",
      {
        kind: "epic",
        title: "Ship it",
        partOf: "platform",
        status: "open",
        order: 0,
        archived: false,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
      "Source idea: [Capture](issue:capture)\n",
    );
    writeIssue(
      "nested-story",
      {
        kind: "story",
        title: "Nested",
        partOf: "ship-it",
        order: 0,
        archived: false,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
      "Source idea: [Capture](issue:capture)\n",
    );

    const { readAll } = await import("./issues.js");
    const { findPlanningWorkRoot } = await import("./planning-work-root.js");
    const { issues } = readAll();
    expect(findPlanningWorkRoot("capture", issues)).toEqual({
      id: "ship-it",
      title: "Ship it",
      kind: "epic",
    });
  });

  it("returns a project-level Story whose description backlinks the Idea", async () => {
    writeIssue("platform", {
      kind: "project",
      title: "Platform",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });
    writeIssue("capture", {
      kind: "idea",
      title: "Capture",
      partOf: "platform",
      order: 0,
      archived: false,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });
    writeIssue(
      "solo-story",
      {
        kind: "story",
        title: "Solo story",
        partOf: "platform",
        order: 0,
        archived: false,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
      "Source idea: [Capture](issue:capture)\n",
    );

    const { readAll } = await import("./issues.js");
    const { findPlanningWorkRoot } = await import("./planning-work-root.js");
    const { issues } = readAll();
    expect(findPlanningWorkRoot("capture", issues)).toEqual({
      id: "solo-story",
      title: "Solo story",
      kind: "story",
    });
  });

  it("returns null when no root backlinks the Idea yet", async () => {
    writeIssue("platform", {
      kind: "project",
      title: "Platform",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });
    writeIssue("capture", {
      kind: "idea",
      title: "Capture",
      partOf: "platform",
      order: 0,
      archived: false,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });

    const { readAll } = await import("./issues.js");
    const { findPlanningWorkRoot } = await import("./planning-work-root.js");
    const { issues } = readAll();
    expect(findPlanningWorkRoot("capture", issues)).toBeNull();
  });
});
