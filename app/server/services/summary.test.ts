import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Issue } from "../schemas.js";
import {
  buildSummary,
  formatSummary,
  summarizeDescription,
  type SummaryAttachment,
} from "./summary.js";

const AT = "2026-07-09T14:00:00.000Z";

/** Project → Epic → root Branch → stacked Branch → Commit (nested stack). */
const nestedIssues: Issue[] = [
  { id: "p", kind: "project", title: "Proj", order: 0, createdAt: AT, updatedAt: AT },
  {
    id: "e",
    kind: "epic",
    title: "Epic",
    partOf: "p",
    blockedBy: [],
    needsAttention: false,
    attentionReason: null,
    archived: false,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  },
  {
    id: "root",
    kind: "story",
    title: "Root Branch",
    partOf: "e",
    branchName: "feat/root",
    merged: false,
    needsAttention: false,
    attentionReason: null,
    archived: false,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  },
  {
    id: "stacked",
    kind: "story",
    title: "Stacked Branch",
    partOf: "e",
    stackedOn: "root",
    branchName: "feat/stacked",
    merged: false,
    needsAttention: false,
    attentionReason: null,
    archived: false,
    order: 1,
    createdAt: AT,
    updatedAt: AT,
  },
  {
    id: "c1",
    kind: "task",
    title: "Do the thing",
    partOf: "stacked",
    status: "todo",
    needsAttention: false,
    attentionReason: null,
    archived: false,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  },
];

const descriptions: Record<string, string> = {
  p: "# Proj\n\nProject overview.\n",
  e: "# Epic\n\nEpic body of work.\n",
  root: "# Root\n\nRoot branch work.\n",
  stacked: "# Stacked\n\nStacked branch work.\n",
  c1: "# Do the thing\n\nImplement the feature.\n\n## Verify\n\n- tests\n",
};

const descriptionOf = (id: string) => descriptions[id] ?? "";

describe("summarizeDescription", () => {
  it("strips a leading heading and returns the first paragraph", () => {
    expect(
      summarizeDescription("# Title\n\nFirst para.\n\nSecond para.\n"),
    ).toBe("First para.");
  });

  it("returns empty string for blank or heading-only markdown", () => {
    expect(summarizeDescription("")).toBe("");
    expect(summarizeDescription("# Only heading\n")).toBe("");
  });
});

describe("buildSummary", () => {
  it("walks partOf for a commit on a nested stacked branch", () => {
    const result = buildSummary("c1", nestedIssues, descriptionOf);

    expect(result.nodes.map((n) => n.id)).toEqual([
      "p",
      "e",
      "stacked",
      "c1",
    ]);
    expect(result.nodes.map((n) => n.kind)).toEqual([
      "project",
      "epic",
      "story",
      "task",
    ]);
    // Containment only — stackedOn parent is not in the chain.
    expect(result.nodes.map((n) => n.id)).not.toContain("root");
    expect(result.nodes[3].descriptionSummary).toBe("Implement the feature.");
    expect(result.nodes[2].descriptionSummary).toBe("Stacked branch work.");
  });

  it("throws not_found for a missing id", () => {
    expect(() => buildSummary("ghost", nestedIssues, descriptionOf)).toThrow(
      /unknown issue "ghost"/,
    );
  });

  it("stops at a branch when summarizing a branch id", () => {
    const result = buildSummary("stacked", nestedIssues, descriptionOf);
    expect(result.nodes.map((n) => n.id)).toEqual(["p", "e", "stacked"]);
  });

  it("walks Project → Story → Task for a project-level Story", () => {
    const projectLevel: Issue[] = [
      {
        id: "p",
        kind: "project",
        title: "Proj",
        order: 0,
        createdAt: AT,
        updatedAt: AT,
      },
      {
        id: "solo",
        kind: "story",
        title: "Solo",
        partOf: "p",
        merged: false,
        needsAttention: false,
        attentionReason: null,
        archived: false,
        order: 0,
        createdAt: AT,
        updatedAt: AT,
      },
      {
        id: "t1",
        kind: "task",
        title: "Task",
        partOf: "solo",
        status: "todo",
        needsAttention: false,
        attentionReason: null,
        archived: false,
        order: 0,
        createdAt: AT,
        updatedAt: AT,
      },
    ];
    const result = buildSummary("t1", projectLevel, (id) =>
      id === "t1" ? "# Task\n\nDo it.\n" : "",
    );
    expect(result.nodes.map((n) => n.kind)).toEqual([
      "project",
      "story",
      "task",
    ]);
    expect(result.nodes.map((n) => n.id)).toEqual(["p", "solo", "t1"]);
    const text = formatSummary(result);
    expect(text).toContain("Story: solo — Solo");
    expect(text).not.toContain("Epic:");
  });
});

describe("formatSummary", () => {
  it("renders the agent-oriented outline with a show pointer", () => {
    const text = formatSummary(buildSummary("c1", nestedIssues, descriptionOf));

    expect(text).toContain("This is an issue in the Proj Project. Here are the details:");
    expect(text).toContain("Project: p — Proj");
    expect(text).toContain("Epic: e — Epic");
    expect(text).toContain("Story: stacked — Stacked Branch");
    expect(text).toContain("Task: c1 — Do the thing");
    expect(text).toContain("Description: Implement the feature.");
    expect(text).toContain("For more details, try `issue <kind> view <id>` or `issue tree`.");
    expect(text).not.toContain("Workspace:");
  });

  it("prints noDiff in the Commit section when set", () => {
    const withNoDiff = nestedIssues.map((issue) =>
      issue.id === "c1" ? { ...issue, noDiff: true } : issue,
    );
    const text = formatSummary(buildSummary("c1", withNoDiff, descriptionOf));

    expect(text).toContain("Task: c1 — Do the thing");
    expect(text).toContain("  noDiff: true");
  });

  it("omits noDiff from summary when unset", () => {
    const text = formatSummary(buildSummary("c1", nestedIssues, descriptionOf));
    expect(text).not.toContain("noDiff:");
  });

  it("prints Workspace in the Project section when set", () => {
    const withWorkspace = nestedIssues.map((issue) =>
      issue.id === "p" ? { ...issue, workspace: "/tmp/repo" } : issue,
    );
    const summary = buildSummary("c1", withWorkspace, descriptionOf);
    expect(summary.workspace).toBe("/tmp/repo");
    const text = formatSummary(summary);

    expect(text).toContain("Project: p — Proj");
    expect(text).toContain("  Workspace: /tmp/repo");
    expect(text).not.toContain("mergePolicy");
  });

  it("prints attachments when attachmentsOf returns them and omits when empty", () => {
    const attachmentsOf = (
      id: string,
    ): SummaryAttachment[] | undefined =>
      id === "c1" ? [{ name: "mock.tsx", size: 6 }] : undefined;
    const summary = buildSummary(
      "c1",
      nestedIssues,
      descriptionOf,
      attachmentsOf,
    );
    expect(summary.nodes[3].attachments).toEqual([
      { name: "mock.tsx", size: 6 },
    ]);
    const text = formatSummary(summary);
    expect(text).toContain("  Attachments:");
    expect(text).toContain("  mock.tsx (6 bytes) — ");
    expect(text).toMatch(/attachments\/mock\.tsx/);

    const empty = formatSummary(buildSummary("c1", nestedIssues, descriptionOf));
    expect(empty).not.toContain("Attachments:");
  });
});

describe("summarize I/O wrapper", () => {
  let dir: string;

  function writeIssue(
    id: string,
    body: Record<string, unknown>,
    description?: string,
  ): void {
    mkdirSync(join(dir, id), { recursive: true });
    writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
    if (description !== undefined) {
      writeFileSync(join(dir, id, "description.md"), description);
    }
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "issue-tracker-summary-"));
    vi.resetModules();
    vi.stubEnv("ISSUES_DIR", dir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads from disk and surfaces unknown ids", async () => {
    writeIssue("p", { kind: "project", title: "Proj", createdAt: AT, updatedAt: AT });
    writeIssue("e", {
      kind: "epic",
      title: "Epic",
      partOf: "p",
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue(
      "b",
      {
        kind: "story",
        title: "Branch",
        partOf: "e",
        merged: false,
        createdAt: AT,
        updatedAt: AT,
      },
      "# Branch\n\nBranch body.\n",
    );
    writeIssue(
      "c1",
      {
        kind: "task",
        title: "Do the thing",
        partOf: "b",
        status: "todo",
        createdAt: AT,
        updatedAt: AT,
      },
      "# Do the thing\n\nImplement the feature.\n",
    );

    const { summarize } = await import("./summary.js");
    const result = summarize("c1");
    expect(result.nodes.map((n) => n.id)).toEqual(["p", "e", "b", "c1"]);
    expect(result.nodes[3].descriptionSummary).toBe("Implement the feature.");
    expect(() => summarize("ghost")).toThrow(/unknown issue "ghost"/);
  });
});
