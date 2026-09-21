import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Issue } from "../schemas.js";
import {
  buildSummary,
  formatSummary,
  resolveSummaryWorkspace,
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

const projectWorkspace = "/tmp/project-ws";

function withProjectWorkspace(issues: Issue[]): Issue[] {
  return issues.map((issue) =>
    issue.id === "p" ? { ...issue, workspace: projectWorkspace } : issue,
  );
}

/** Project → Epic → Story → Idea (append target is the Story). */
const ideaIssues: Issue[] = [
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
    id: "target-story",
    kind: "story",
    title: "Append target",
    partOf: "e",
    branchName: "feat/target",
    merged: false,
    needsAttention: false,
    attentionReason: null,
    archived: false,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  },
  {
    id: "idea-1",
    kind: "idea",
    title: "Capture",
    partOf: "p",
    archived: false,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  },
];

function ideaChain(issues: Issue[]): Issue[] {
  return issues.filter((i) => ["p", "e", "idea-1"].includes(i.id));
}

function issuesById(issues: Issue[]): Map<string, Issue> {
  return new Map(issues.map((issue) => [issue.id, issue]));
}

describe("resolveSummaryWorkspace", () => {
  it("uses a Story worktree when the directory exists", () => {
    const worktree = mkdtempSync(join(tmpdir(), "story-wt-"));
    try {
      const issues = withProjectWorkspace(
        nestedIssues.map((issue) =>
          issue.id === "stacked"
            ? { ...issue, worktreePath: worktree }
            : issue,
        ),
      );
      const chain = issues.filter((i) =>
        ["p", "e", "stacked"].includes(i.id),
      );
      expect(resolveSummaryWorkspace(chain, projectWorkspace)).toBe(worktree);
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  it("falls back to the Project workspace when the Story has no worktreePath", () => {
    const chain = withProjectWorkspace(nestedIssues).filter((i) =>
      ["p", "e", "stacked"].includes(i.id),
    );
    expect(resolveSummaryWorkspace(chain, projectWorkspace)).toBe(
      projectWorkspace,
    );
  });

  it("falls back when the recorded worktree directory no longer exists", () => {
    const issues = withProjectWorkspace(
      nestedIssues.map((issue) =>
        issue.id === "stacked"
          ? { ...issue, worktreePath: "/tmp/vanished-worktree-path" }
          : issue,
      ),
    );
    const chain = issues.filter((i) => ["p", "e", "stacked"].includes(i.id));
    expect(resolveSummaryWorkspace(chain, projectWorkspace)).toBe(
      projectWorkspace,
    );
  });

  it("resolves a Task through its containing Story", () => {
    const worktree = mkdtempSync(join(tmpdir(), "task-wt-"));
    try {
      const issues = withProjectWorkspace(
        nestedIssues.map((issue) =>
          issue.id === "stacked"
            ? { ...issue, worktreePath: worktree }
            : issue,
        ),
      );
      const chain = issues.filter((i) =>
        ["p", "e", "stacked", "c1"].includes(i.id),
      );
      expect(resolveSummaryWorkspace(chain, projectWorkspace)).toBe(worktree);
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  it("uses the append-target Story worktree for an Idea with appendTo", () => {
    const worktree = mkdtempSync(join(tmpdir(), "idea-wt-"));
    try {
      const issues = withProjectWorkspace(
        ideaIssues.map((issue) => {
          if (issue.id === "idea-1") return { ...issue, appendTo: "target-story" };
          if (issue.id === "target-story") return { ...issue, worktreePath: worktree };
          return issue;
        }),
      );
      const chain = ideaChain(issues);
      expect(
        resolveSummaryWorkspace(chain, projectWorkspace, issuesById(issues)),
      ).toBe(worktree);
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  it("falls back to the Project workspace when the append-target has no live worktree", () => {
    const issues = withProjectWorkspace(
      ideaIssues.map((issue) =>
        issue.id === "idea-1" ? { ...issue, appendTo: "target-story" } : issue,
      ),
    );
    const chain = ideaChain(issues);
    expect(
      resolveSummaryWorkspace(chain, projectWorkspace, issuesById(issues)),
    ).toBe(projectWorkspace);
  });

  it("falls back when the append-target worktree directory is missing", () => {
    const issues = withProjectWorkspace(
      ideaIssues.map((issue) => {
        if (issue.id === "idea-1") return { ...issue, appendTo: "target-story" };
        if (issue.id === "target-story")
          return { ...issue, worktreePath: "/tmp/vanished-idea-worktree" };
        return issue;
      }),
    );
    const chain = ideaChain(issues);
    expect(
      resolveSummaryWorkspace(chain, projectWorkspace, issuesById(issues)),
    ).toBe(projectWorkspace);
  });

  it("omits workspace for an Idea with appendTo when no worktree and Project workspace unset", () => {
    const issues = ideaIssues.map((issue) =>
      issue.id === "idea-1" ? { ...issue, appendTo: "target-story" } : issue,
    );
    const chain = ideaChain(issues);
    expect(
      resolveSummaryWorkspace(chain, undefined, issuesById(issues)),
    ).toBeUndefined();
  });

  it("prints the Project workspace for an Idea with no appendTo", () => {
    const issues = withProjectWorkspace(ideaIssues);
    const chain = ideaChain(issues);
    expect(
      resolveSummaryWorkspace(chain, projectWorkspace, issuesById(issues)),
    ).toBe(projectWorkspace);
  });

  it("omits workspace for an Idea with no appendTo when Project workspace unset", () => {
    const chain = ideaChain(ideaIssues);
    expect(
      resolveSummaryWorkspace(chain, undefined, issuesById(ideaIssues)),
    ).toBeUndefined();
  });

  it("throws for a missing append-target Story", () => {
    const issues = withProjectWorkspace(
      ideaIssues.map((issue) =>
        issue.id === "idea-1" ? { ...issue, appendTo: "ghost-story" } : issue,
      ),
    );
    const chain = ideaChain(issues);
    expect(() =>
      resolveSummaryWorkspace(chain, projectWorkspace, issuesById(issues)),
    ).toThrow(/unknown issue "ghost-story"/);
  });
});

describe("buildSummary", () => {
  it("walks partOf for a commit on a nested stacked branch", () => {
    const result = buildSummary("c1", nestedIssues);

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
  });

  it("throws not_found for a missing id", () => {
    expect(() => buildSummary("ghost", nestedIssues)).toThrow(
      /unknown issue "ghost"/,
    );
  });

  it("stops at a branch when summarizing a branch id", () => {
    const result = buildSummary("stacked", nestedIssues);
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
    const result = buildSummary("t1", projectLevel);
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
    const text = formatSummary(buildSummary("c1", nestedIssues));

    expect(text).toContain("This is an issue in the Proj Project. Here are the details:");
    expect(text).toContain("Project: p — Proj");
    expect(text).toContain("Epic: e — Epic");
    expect(text).toContain("Story: stacked — Stacked Branch");
    expect(text).toContain("Task: c1 — Do the thing");
    expect(text).toContain("For more details, try `issue <kind> view <id>` or `issue tree`.");
    expect(text).not.toContain("Description:");
    expect(text).not.toContain("Workspace:");
  });

  it("prints noDiff in the Commit section when set", () => {
    const withNoDiff = nestedIssues.map((issue) =>
      issue.id === "c1" ? { ...issue, noDiff: true } : issue,
    );
    const text = formatSummary(buildSummary("c1", withNoDiff));

    expect(text).toContain("Task: c1 — Do the thing");
    expect(text).toContain("  noDiff: true");
  });

  it("omits noDiff from summary when unset", () => {
    const text = formatSummary(buildSummary("c1", nestedIssues));
    expect(text).not.toContain("noDiff:");
  });

  it("prints Workspace in the Project section when set", () => {
    const withWorkspace = nestedIssues.map((issue) =>
      issue.id === "p" ? { ...issue, workspace: "/tmp/repo" } : issue,
    );
    const summary = buildSummary("c1", withWorkspace);
    expect(summary.workspace).toBe("/tmp/repo");
    const text = formatSummary(summary);

    expect(text).toContain("Project: p — Proj");
    expect(text).toContain("  Workspace: /tmp/repo");
    expect(text).not.toContain("mergePolicy");
  });

  it("prints a live Story worktree as Workspace instead of the Project path", () => {
    const worktree = mkdtempSync(join(tmpdir(), "summary-wt-"));
    try {
      const issues = nestedIssues.map((issue) => {
        if (issue.id === "p") return { ...issue, workspace: "/tmp/repo" };
        if (issue.id === "stacked")
          return { ...issue, worktreePath: worktree };
        return issue;
      });
      const summary = buildSummary("stacked", issues);
      expect(summary.workspace).toBe(worktree);
      expect(formatSummary(summary)).toContain(`  Workspace: ${worktree}`);
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  it("falls back to Project workspace when the Story worktree path is missing on disk", () => {
    const issues = nestedIssues.map((issue) => {
      if (issue.id === "p") return { ...issue, workspace: "/tmp/repo" };
      if (issue.id === "stacked")
        return { ...issue, worktreePath: "/tmp/gone-worktree" };
      return issue;
    });
    const summary = buildSummary("c1", issues);
    expect(summary.workspace).toBe("/tmp/repo");
  });

  it("prints the append-target worktree as Workspace for an Idea with appendTo", () => {
    const worktree = mkdtempSync(join(tmpdir(), "idea-summary-wt-"));
    try {
      const issues = withProjectWorkspace(
        ideaIssues.map((issue) => {
          if (issue.id === "idea-1") return { ...issue, appendTo: "target-story" };
          if (issue.id === "target-story") return { ...issue, worktreePath: worktree };
          return issue;
        }),
      );
      const summary = buildSummary("idea-1", issues);
      expect(summary.workspace).toBe(worktree);
      expect(formatSummary(summary)).toContain(`  Workspace: ${worktree}`);
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  it("falls back to Project workspace for an Idea with appendTo and no live worktree", () => {
    const issues = withProjectWorkspace(
      ideaIssues.map((issue) =>
        issue.id === "idea-1" ? { ...issue, appendTo: "target-story" } : issue,
      ),
    );
    const summary = buildSummary("idea-1", issues);
    expect(summary.workspace).toBe(projectWorkspace);
    expect(formatSummary(summary)).toContain(`  Workspace: ${projectWorkspace}`);
  });

  it("omits Workspace for an Idea with appendTo when no worktree and Project workspace unset", () => {
    const issues = ideaIssues.map((issue) =>
      issue.id === "idea-1" ? { ...issue, appendTo: "target-story" } : issue,
    );
    const summary = buildSummary("idea-1", issues);
    expect(summary.workspace).toBeUndefined();
    expect(formatSummary(summary)).not.toContain("Workspace:");
  });

  it("prints Project workspace for an Idea with no appendTo", () => {
    const issues = withProjectWorkspace(ideaIssues);
    const summary = buildSummary("idea-1", issues);
    expect(summary.workspace).toBe(projectWorkspace);
    expect(formatSummary(summary)).toContain(`  Workspace: ${projectWorkspace}`);
  });

  it("omits Workspace for an Idea with no appendTo when Project workspace unset", () => {
    const summary = buildSummary("idea-1", ideaIssues);
    expect(summary.workspace).toBeUndefined();
    expect(formatSummary(summary)).not.toContain("Workspace:");
  });

  it("throws for an Idea whose appendTo names a missing Story", () => {
    const issues = withProjectWorkspace(
      ideaIssues.map((issue) =>
        issue.id === "idea-1" ? { ...issue, appendTo: "ghost-story" } : issue,
      ),
    );
    expect(() => buildSummary("idea-1", issues)).toThrow(
      /unknown issue "ghost-story"/,
    );
  });

  it("prints Mission in the Project section when missionOf returns a paragraph", () => {
    const withDocs = nestedIssues.map((issue) =>
      issue.id === "p"
        ? {
            ...issue,
            supportingDocs: {
              vision: { type: "attachment" as const, name: "vision.md" },
            },
          }
        : issue,
    );
    const missionOf = () => "Ship durable human/agent plans.";
    const summary = buildSummary("c1", withDocs, () => undefined, missionOf);
    expect(summary.mission).toBe("Ship durable human/agent plans.");
    const text = formatSummary(summary);
    expect(text).toContain("  Mission: Ship durable human/agent plans.");
    expect(text.indexOf("  Mission:")).toBeLessThan(
      text.indexOf("  supportingDocs:"),
    );
  });

  it("omits Mission when missionOf returns undefined", () => {
    const withDocs = nestedIssues.map((issue) =>
      issue.id === "p"
        ? {
            ...issue,
            supportingDocs: {
              vision: { type: "attachment" as const, name: "vision.md" },
            },
          }
        : issue,
    );
    const text = formatSummary(buildSummary("c1", withDocs));
    expect(text).not.toContain("Mission:");
  });

  it("prints attachments when attachmentsOf returns them and omits when empty", () => {
    const attachmentsOf = (
      id: string,
    ): SummaryAttachment[] | undefined =>
      id === "c1" ? [{ name: "mock.tsx", size: 6 }] : undefined;
    const summary = buildSummary(
      "c1",
      nestedIssues,
      attachmentsOf,
    );
    expect(summary.nodes[3].attachments).toEqual([
      { name: "mock.tsx", size: 6 },
    ]);
    const text = formatSummary(summary);
    expect(text).toContain("  Attachments:");
    expect(text).toContain("  mock.tsx (6 bytes) — ");
    expect(text).toMatch(/attachments\/mock\.tsx/);

    const empty = formatSummary(buildSummary("c1", nestedIssues));
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
    expect(() => summarize("ghost")).toThrow(/unknown issue "ghost"/);
  });
});
