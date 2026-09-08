import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  baseDoc,
  epicChildren,
  loadService,
  readIssue,
  useApplyTestFixtures,
} from "./apply.test-fixtures.js";

useApplyTestFixtures();

describe("apply — update preserves imperative progress state", () => {
  it("keeps progress fields and comments.jsonl when the doc updates a node", async () => {
    const { apply, update, appendComment, readComments } = await loadService();
    await apply(baseDoc());

    // Stamp imperative/runtime state that lives outside the doc.
    await update("epic-a", { retro: "in-progress" });
    await update("b2", {
      branchName: "feat/b2",
      prUrl: "https://example.test/pr/2",
      merged: true,
      review: "failed",
      retro: "in-progress",
      needsAttention: true,
      attentionReason: "waiting on review",
    });
    await update("c1", {
      status: "fixing",
      qa: "changes-requested",
      commits: ["deadbeef00000000000000000000000000000000"],
      noDiff: true,
      assignee: "bob",
      needsAttention: true,
      attentionReason: "verify locally",
    });
    await appendComment("b2", { role: "agent", body: "progress note" });

    // Re-apply with changed titles so b2 and c1 actually go through the update path.
    const doc = baseDoc();
    epicChildren(doc)[0].title = "Epic A renamed";
    epicChildren(doc)[0].children![1].title = "Branch two renamed";
    epicChildren(doc)[0].children![0].children![0].title = "Commit one renamed";
    const summary = await apply(doc);
    expect(summary.updated.sort()).toEqual(["b2", "c1", "epic-a"]);
    expect(summary.deleted).toEqual([]);

    const epicA = readIssue("epic-a");
    expect(epicA.title).toBe("Epic A renamed");
    expect(epicA.retro).toBe("in-progress");

    const b2 = readIssue("b2");
    expect(b2.title).toBe("Branch two renamed");
    expect(b2.branchName).toBe("feat/b2");
    expect(b2.mergeBase).toBeUndefined();
    expect(b2.prUrl).toBe("https://example.test/pr/2");
    expect(b2.merged).toBe(true);
    expect(b2.review).toBe("failed");
    expect(b2.retro).toBe("in-progress");
    expect("assignee" in b2).toBe(false);
    expect(b2.needsAttention).toBe(true);
    expect(b2.attentionReason).toBe("waiting on review");

    const c1 = readIssue("c1");
    expect(c1.title).toBe("Commit one renamed");
    expect(c1.status).toBe("fixing");
    expect(c1.qa).toBe("changes-requested");
    expect(c1.commits).toEqual(["deadbeef00000000000000000000000000000000"]);
    expect(c1.noDiff).toBe(true);
    expect(c1.assignee).toBe("bob");
    expect(c1.needsAttention).toBe(true);
    expect(c1.attentionReason).toBe("verify locally");

    const comments = readComments("b2");
    expect(comments.problems).toEqual([]);
    expect(comments.messages.map((m) => m.body)).toEqual(["progress note"]);
  });

  it("preserves project workspace when the doc updates a project", async () => {
    const { apply, update } = await loadService();
    await apply(baseDoc());

    const ws = mkdtempSync(join(tmpdir(), "issue-apply-workspace-"));
    mkdirSync(join(ws, ".git"));
    try {
      await update("proj", { workspace: ws });

      const doc = baseDoc();
      doc.project.title = "Project renamed";
      const summary = await apply(doc);
      expect(summary.updated).toContain("proj");

      const proj = readIssue("proj");
      expect(proj.title).toBe("Project renamed");
      expect(proj.workspace).toBe(ws);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it("preserves project mergePolicy when the doc updates a project", async () => {
    const { apply, update } = await loadService();
    await apply(baseDoc());

    await update("proj", { mergePolicy: "pull-request" });

    const doc = baseDoc();
    doc.project.title = "Project renamed again";
    const summary = await apply(doc);
    expect(summary.updated).toContain("proj");

    const proj = readIssue("proj");
    expect(proj.title).toBe("Project renamed again");
    expect(proj.mergePolicy).toBe("pull-request");
  });

  it("preserves project supportingDocs when the doc updates a project", async () => {
    const { apply, update } = await loadService();
    await apply(baseDoc());

    const ws = mkdtempSync(join(tmpdir(), "issue-apply-supporting-docs-"));
    mkdirSync(join(ws, ".git"));
    writeFileSync(join(ws, "vision.md"), "# Vision");
    try {
      await update("proj", { workspace: ws });
      await update("proj", {
        supportingDocs: {
          vision: { type: "workspace", path: "vision.md" },
        },
      });

      const doc = baseDoc();
      doc.project.title = "Project with docs preserved";
      const summary = await apply(doc);
      expect(summary.updated).toContain("proj");

      const proj = readIssue("proj");
      expect(proj.title).toBe("Project with docs preserved");
      expect(proj.supportingDocs).toEqual({
        vision: { type: "workspace", path: "vision.md" },
      });
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it("preserves project inspirationApps when the doc updates a project", async () => {
    const { apply, update } = await loadService();
    await apply(baseDoc());

    await update("proj", {
      inspirationApps: [
        {
          name: "Notion",
          url: "https://notion.so",
          description: "Notes",
        },
      ],
    });

    const doc = baseDoc();
    doc.project.title = "Project with apps preserved";
    const summary = await apply(doc);
    expect(summary.updated).toContain("proj");

    const proj = readIssue("proj");
    expect(proj.title).toBe("Project with apps preserved");
    expect(proj.inspirationApps).toEqual([
      {
        name: "Notion",
        url: "https://notion.so",
        description: "Notes",
      },
    ]);
  });

  it("preserves project personas when the doc updates a project", async () => {
    const { apply, update } = await loadService();
    await apply(baseDoc());

    await update("proj", {
      personas: [{ name: "Planner", description: "Plans work" }],
    });

    const doc = baseDoc();
    doc.project.title = "Project with personas preserved";
    const summary = await apply(doc);
    expect(summary.updated).toContain("proj");

    const proj = readIssue("proj");
    expect(proj.title).toBe("Project with personas preserved");
    expect(proj.personas).toEqual([
      { name: "Planner", description: "Plans work" },
    ]);
  });

  it("preserves project catalog and issue label assignments across re-apply", async () => {
    const { apply, update } = await loadService();
    await apply(baseDoc());

    await update("proj", {
      labels: [
        { id: "bug", color: "#ff0000" },
        { id: "feat", color: "#00ff00" },
      ],
    });
    await update("epic-a", { labels: ["bug", "feat"] });
    await update("b1", { labels: ["feat"] });

    const doc = baseDoc();
    doc.project.title = "Project with labels preserved";
    const summary = await apply(doc);
    expect(summary.updated).toContain("proj");

    const proj = readIssue("proj");
    expect(proj.title).toBe("Project with labels preserved");
    expect(proj.labels).toEqual([
      { id: "bug", color: "#ff0000" },
      { id: "feat", color: "#00ff00" },
    ]);
    expect(readIssue("epic-a").labels).toEqual(["bug", "feat"]);
    expect(readIssue("b1").labels).toEqual(["feat"]);
  });
});
