import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import {
  exportDraftFiles,
  type ExportRewriteNode,
} from "./export-rewrite.js";

function splitDraft(content: string): { title: string; body: string } {
  expect(content.startsWith("---\n")).toBe(true);
  const end = content.indexOf("\n---\n", 4);
  expect(end).toBeGreaterThan(0);
  const parsed = parseYaml(content.slice(4, end)) as { title: string };
  return { title: parsed.title, body: content.slice(end + "\n---\n".length) };
}

describe("exportDraftFiles", () => {
  it("maps an Epic to an epic file plus Story files in tracker order", () => {
    const nodes = [
      {
        id: "ship",
        kind: "epic" as const,
        title: "Ship: it",
        description: "Epic prose\n",
        order: 0,
        partOf: "platform",
        status: "STATUS-SENTINEL",
        comments: "COMMENT-SENTINEL",
        assignee: "ASSIGNEE-SENTINEL",
        blockedBy: ["BLOCKER-SENTINEL"],
      },
      {
        id: "later",
        kind: "story" as const,
        title: "Later story",
        description: "Later body",
        order: 1,
        partOf: "ship",
        comments: "COMMENT-SENTINEL",
      },
      {
        id: "first",
        kind: "story" as const,
        title: "First story",
        description: "First body",
        order: 0,
        partOf: "ship",
        status: "STATUS-SENTINEL",
      },
      {
        id: "stacked",
        kind: "story" as const,
        title: "Stacked story",
        description: "Stacked body",
        order: 0,
        partOf: "ship",
        stackedOn: "first",
        assignee: "ASSIGNEE-SENTINEL",
      },
      {
        id: "task-late",
        kind: "task" as const,
        title: "Second task",
        description: "Second task body",
        order: 1,
        partOf: "first",
        status: "STATUS-SENTINEL",
        comments: "COMMENT-SENTINEL",
        assignee: "ASSIGNEE-SENTINEL",
      },
      {
        id: "task-early",
        kind: "task" as const,
        title: "First task",
        description: "First task body\n",
        order: 0,
        partOf: "first",
      },
      {
        id: "other-task",
        kind: "task" as const,
        title: "Elsewhere",
        description: "Not on this epic",
        order: 0,
        partOf: "outside",
      },
    ];

    const files = exportDraftFiles("ship", nodes);
    expect(files.map((file) => file.name)).toEqual([
      "github-export-ship.md",
      "github-export-first.md",
      "github-export-stacked.md",
      "github-export-later.md",
    ]);

    const epic = splitDraft(files[0]!.content);
    expect(epic.title).toBe("Ship: it");
    expect(epic.body).toBe(
      "Epic prose\n\n- [ ] First story\n- [ ] Stacked story\n- [ ] Later story\n",
    );

    const first = splitDraft(files[1]!.content);
    expect(first.title).toBe("First story");
    expect(first.body).toBe(
      "First body\n\n## First task\n\nFirst task body\n\n## Second task\n\nSecond task body\n",
    );
    expect(first.body.indexOf("## First task")).toBeLessThan(
      first.body.indexOf("## Second task"),
    );

    const stacked = splitDraft(files[2]!.content);
    expect(stacked.title).toBe("Stacked story");
    expect(stacked.body).toBe("Stacked body\n");
    expect(stacked.body).not.toContain("## ");

    const serialized = JSON.stringify(files);
    expect(serialized).not.toContain("STATUS-SENTINEL");
    expect(serialized).not.toContain("COMMENT-SENTINEL");
    expect(serialized).not.toContain("ASSIGNEE-SENTINEL");
    expect(serialized).not.toContain("BLOCKER-SENTINEL");
    expect(serialized).not.toContain("Not on this epic");
  });

  it("maps a project-level Story to one file with Tasks in tracker order", () => {
    const nodes: ExportRewriteNode[] = [
      {
        id: "solo",
        kind: "story",
        title: "Solo story",
        description: "Story prose",
        order: 0,
        partOf: "platform",
      },
      {
        id: "z-task",
        kind: "task",
        title: "Zed",
        description: "Zed body",
        order: 2,
        partOf: "solo",
      },
      {
        id: "a-task",
        kind: "task",
        title: "Aye",
        description: "Aye body",
        order: 0,
        partOf: "solo",
      },
      {
        id: "m-task",
        kind: "task",
        title: "Em",
        description: "",
        order: 1,
        partOf: "solo",
      },
    ];
    const withIgnored = nodes.map((node, index) =>
      index === 0
        ? {
            ...node,
            status: "STATUS-SENTINEL",
            comments: "COMMENT-SENTINEL",
            assignee: "ASSIGNEE-SENTINEL",
          }
        : node,
    );

    const files = exportDraftFiles("solo", withIgnored);
    expect(files.map((file) => file.name)).toEqual(["github-export-solo.md"]);
    const story = splitDraft(files[0]!.content);
    expect(story.title).toBe("Solo story");
    expect(story.body).toBe(
      "Story prose\n\n## Aye\n\nAye body\n\n## Em\n\n## Zed\n\nZed body\n",
    );
    expect(story.body).not.toContain("- [ ]");
    const serialized = JSON.stringify(files);
    expect(serialized).not.toContain("STATUS-SENTINEL");
    expect(serialized).not.toContain("COMMENT-SENTINEL");
    expect(serialized).not.toContain("ASSIGNEE-SENTINEL");
  });

  it("refuses a root that is not an Epic or Story", () => {
    const nodes: ExportRewriteNode[] = [
      {
        id: "t",
        kind: "task",
        title: "Task",
        description: "Body",
        order: 0,
        partOf: "solo",
      },
    ];
    expect(() => exportDraftFiles("t", nodes)).toThrow(
      /not an Epic or project-level Story/,
    );
    expect(() => exportDraftFiles("missing", nodes)).toThrow(
      /unknown issue "missing"/,
    );
  });
});
