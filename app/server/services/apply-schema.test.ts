import { describe, expect, it } from "vitest";
import {
  flattenApplyDoc,
  parseApplyDoc,
  type DesiredIssue,
} from "./apply-schema";

// A representative doc covering every kind and every inferred relationship:
// interleaved epic/idea/story project children, root and stacked stories
// (nested to depth 2), tasks, and an explicit epic-level blockedBy reference
// (epic-empty blocks on epic-billing).
const doc = {
  project: {
    id: "my-project",
    title: "My Project",
    description: "Overview...",
    children: [
      {
        kind: "epic" as const,
        id: "epic-billing",
        title: "Billing rework",
        description: "Cross-cutting invariants...",
        children: [
          {
            kind: "story" as const,
            id: "phase-0",
            title: "Extract tx cache",
            description: "Scope + approach.",
            children: [
              {
                kind: "task" as const,
                id: "p0-extract-module",
                title: "Extract tx-cache module",
                description: "What to do + how to verify.",
              },
              {
                kind: "story" as const,
                id: "phase-1",
                title: "Stats tables",
                children: [
                  {
                    kind: "story" as const,
                    id: "phase-2",
                    title: "Deeper stack",
                  },
                ],
              },
            ],
          },
          {
            kind: "story" as const,
            id: "phase-0b",
            title: "Parallel work",
          },
        ],
      },
      {
        kind: "idea" as const,
        id: "capture-cache",
        title: "Cache idea",
        description: "Maybe later.",
      },
      {
        kind: "epic" as const,
        id: "epic-empty",
        title: "Empty epic",
        blockedBy: ["epic-billing"],
      },
    ],
  },
};

function byId(desired: DesiredIssue[]): Map<string, DesiredIssue> {
  return new Map(desired.map((issue) => [issue.id, issue]));
}

describe("parseApplyDoc", () => {
  it("accepts a well-formed doc", () => {
    const result = parseApplyDoc(doc);
    expect(result.ok).toBe(true);
  });

  it("rejects a missing project", () => {
    const result = parseApplyDoc({});
    expect(result).toEqual({
      ok: false,
      message: expect.stringContaining("project"),
    });
  });

  it("rejects rooted branch: (old YAML key)", () => {
    const result = parseApplyDoc({
      project: "p",
      epic: "e",
      branch: { id: "b", title: "B" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('"story:"');
  });

  it("rejects project-rooted epics: (replaced by children:)", () => {
    const result = parseApplyDoc({
      project: {
        id: "p",
        title: "P",
        epics: [{ id: "e", title: "E" }],
      },
    });
    expect(result).toEqual({
      ok: false,
      message:
        'project "epics:" is no longer accepted; use "children:" with kind: epic | idea | story',
    });
  });

  it("rejects branches/commits child keys (old YAML keys)", () => {
    const result = parseApplyDoc({
      project: {
        id: "p",
        title: "P",
        children: [
          {
            kind: "epic",
            id: "e",
            title: "E",
            branches: [{ id: "b", title: "B", commits: [{ id: "c", title: "C" }] }],
          },
        ],
      },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects legacy stories/tasks/stacked keys as unknown", () => {
    const withStories = parseApplyDoc({
      project: {
        id: "p",
        title: "P",
        children: [
          {
            kind: "epic",
            id: "e",
            title: "E",
            stories: [{ kind: "story", id: "b", title: "B" }],
          },
        ],
      },
    });
    expect(withStories.ok).toBe(false);

    const withTasks = parseApplyDoc({
      project: {
        id: "p",
        title: "P",
        children: [
          {
            kind: "story",
            id: "s",
            title: "S",
            tasks: [{ kind: "task", id: "t", title: "T" }],
          },
        ],
      },
    });
    expect(withTasks.ok).toBe(false);

    const withStacked = parseApplyDoc({
      project: {
        id: "p",
        title: "P",
        children: [
          {
            kind: "story",
            id: "s",
            title: "S",
            stacked: [{ kind: "story", id: "x", title: "X" }],
          },
        ],
      },
    });
    expect(withStacked.ok).toBe(false);
  });

  it("rejects invalid kinds under each parent allow-list", () => {
    const taskUnderEpic = parseApplyDoc({
      project: {
        id: "p",
        title: "P",
        children: [
          {
            kind: "epic",
            id: "e",
            title: "E",
            children: [{ kind: "task", id: "t", title: "T" }],
          },
        ],
      },
    });
    expect(taskUnderEpic.ok).toBe(false);

    const ideaUnderEpic = parseApplyDoc({
      project: {
        id: "p",
        title: "P",
        children: [
          {
            kind: "epic",
            id: "e",
            title: "E",
            children: [{ kind: "idea", id: "i", title: "I" }],
          },
        ],
      },
    });
    expect(ideaUnderEpic.ok).toBe(false);

    const epicUnderStory = parseApplyDoc({
      project: {
        id: "p",
        title: "P",
        children: [
          {
            kind: "story",
            id: "s",
            title: "S",
            children: [{ kind: "epic", id: "e", title: "E" }],
          },
        ],
      },
    });
    expect(epicUnderStory.ok).toBe(false);

    const taskUnderProject = parseApplyDoc({
      project: {
        id: "p",
        title: "P",
        children: [{ kind: "task", id: "t", title: "T" }],
      },
    });
    expect(taskUnderProject.ok).toBe(false);
  });

  it("rejects a node missing its id", () => {
    const result = parseApplyDoc({
      project: { title: "No id" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("project.id");
  });

  it("rejects a non-kebab id", () => {
    const result = parseApplyDoc({
      project: { id: "Not A Slug", title: "Bad" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("kebab-case");
  });

  it("rejects an empty title", () => {
    const result = parseApplyDoc({
      project: { id: "p", title: "" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("title");
  });

  it("rejects unknown keys", () => {
    const result = parseApplyDoc({
      project: { id: "p", title: "P", bogus: 1 },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects author-specified order on siblings", () => {
    const result = parseApplyDoc({
      project: {
        id: "p",
        title: "P",
        children: [
          {
            kind: "epic",
            id: "e",
            title: "E",
            children: [
              {
                kind: "story",
                id: "b",
                title: "B",
                children: [
                  { kind: "task", id: "c1", title: "C1", order: 0 },
                  { kind: "task", id: "c2", title: "C2", order: 0 },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an idea child with epic-only keys", () => {
    const result = parseApplyDoc({
      project: {
        id: "p",
        title: "P",
        children: [
          {
            kind: "idea",
            id: "i",
            title: "I",
            children: [{ kind: "story", id: "b", title: "B" }],
          },
        ],
      },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a children entry missing kind", () => {
    const result = parseApplyDoc({
      project: {
        id: "p",
        title: "P",
        children: [{ id: "e", title: "E" }],
      },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects duplicate ids across the doc", () => {
    const result = parseApplyDoc({
      project: {
        id: "dupe",
        title: "Root",
        children: [{ kind: "epic", id: "dupe", title: "Clash" }],
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('duplicate id "dupe"');
  });

  it("detects a duplicate id nested deep in the tree", () => {
    const result = parseApplyDoc({
      project: {
        id: "p",
        title: "P",
        children: [
          {
            kind: "epic",
            id: "e",
            title: "E",
            children: [
              {
                kind: "story",
                id: "b",
                title: "B",
                children: [{ kind: "task", id: "b", title: "collides with story" }],
              },
            ],
          },
        ],
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('duplicate id "b"');
  });
});

describe("flattenApplyDoc", () => {
  const result = parseApplyDoc(doc);
  if (!result.ok) throw new Error(`fixture doc should parse: ${result.message}`);
  const desired = flattenApplyDoc(result.doc);
  const map = byId(desired);

  it("emits every node exactly once", () => {
    expect(desired.map((issue) => issue.id).sort()).toEqual(
      [
        "my-project",
        "epic-billing",
        "capture-cache",
        "epic-empty",
        "phase-0",
        "phase-0b",
        "phase-1",
        "phase-2",
        "p0-extract-module",
      ].sort(),
    );
  });

  it("infers kind from children kind", () => {
    expect(map.get("my-project")?.kind).toBe("project");
    expect(map.get("epic-billing")?.kind).toBe("epic");
    expect(map.get("capture-cache")?.kind).toBe("idea");
    expect(map.get("phase-0")?.kind).toBe("story");
    expect(map.get("p0-extract-module")?.kind).toBe("task");
  });

  it("leaves the project without a partOf", () => {
    const project = map.get("my-project");
    expect(project && "partOf" in project).toBe(false);
  });

  it("infers partOf from the enclosing container", () => {
    const epic = map.get("epic-billing");
    const idea = map.get("capture-cache");
    const story = map.get("phase-0");
    const commit = map.get("p0-extract-module");
    expect(epic && "partOf" in epic && epic.partOf).toBe("my-project");
    expect(idea && "partOf" in idea && idea.partOf).toBe("my-project");
    expect(story && "partOf" in story && story.partOf).toBe("epic-billing");
    expect(commit && "partOf" in commit && commit.partOf).toBe("phase-0");
  });

  it("keeps a stacked story in its epic and records the fork point", () => {
    const stacked = map.get("phase-1");
    if (!stacked || stacked.kind !== "story") throw new Error("missing story");
    expect(stacked.partOf).toBe("epic-billing");
    expect(stacked.stackedOn).toBe("phase-0");
  });

  it("infers stackedOn through nested stacking", () => {
    const deep = map.get("phase-2");
    if (!deep || deep.kind !== "story") throw new Error("missing story");
    expect(deep.partOf).toBe("epic-billing");
    expect(deep.stackedOn).toBe("phase-1");
  });

  it("leaves a root story without a stackedOn", () => {
    const root = map.get("phase-0");
    if (!root || root.kind !== "story") throw new Error("missing story");
    expect(root.stackedOn).toBeUndefined();
  });

  it("carries an epic's blockedBy verbatim and defaults it to []", () => {
    const withBlock = map.get("epic-empty");
    const withoutBlock = map.get("epic-billing");
    if (withBlock?.kind !== "epic" || withoutBlock?.kind !== "epic") {
      throw new Error("missing epic");
    }
    expect(withBlock.blockedBy).toEqual(["epic-billing"]);
    expect(withoutBlock.blockedBy).toEqual([]);
  });

  it("carries descriptions and omits them when absent", () => {
    expect(map.get("my-project")?.description).toBe("Overview...");
    expect(map.get("capture-cache")?.description).toBe("Maybe later.");
    expect(map.get("phase-0b")?.description).toBeUndefined();
  });

  it("infers order from array position for every child level", () => {
    expect(map.get("epic-billing")?.order).toBe(0);
    expect(map.get("capture-cache")?.order).toBe(1);
    expect(map.get("epic-empty")?.order).toBe(2);
    expect(map.get("phase-0")?.order).toBe(0);
    expect(map.get("phase-0b")?.order).toBe(1);
    expect(map.get("phase-1")?.order).toBe(0);
    expect(map.get("phase-2")?.order).toBe(0);
    expect(map.get("p0-extract-module")?.order).toBe(0);
    expect(map.get("my-project")?.order).toBeUndefined();
  });

  it("keeps task and stacked-story order groups separate under a story", () => {
    const interleaved = parseApplyDoc({
      project: {
        id: "p",
        title: "P",
        children: [
          {
            kind: "story",
            id: "solo",
            title: "Solo",
            children: [
              { kind: "task", id: "t1", title: "T1" },
              { kind: "story", id: "s1", title: "S1" },
              { kind: "task", id: "t2", title: "T2" },
              { kind: "story", id: "s2", title: "S2" },
            ],
          },
        ],
      },
    });
    if (!interleaved.ok) throw new Error(interleaved.message);
    const m = byId(flattenApplyDoc(interleaved.doc));
    expect(m.get("t1")?.order).toBe(0);
    expect(m.get("t2")?.order).toBe(1);
    expect(m.get("s1")?.order).toBe(0);
    expect(m.get("s2")?.order).toBe(1);
    expect(m.get("s1")).toMatchObject({ kind: "story", partOf: "p", stackedOn: "solo" });
    expect(m.get("s2")).toMatchObject({ kind: "story", partOf: "p", stackedOn: "solo" });
  });
});

// An epic-rooted doc names its project by id (a reference) and reconciles a
// single epic subtree.
const epicDoc = {
  project: "my-product",
  epic: {
    id: "epic-a",
    title: "Epic A",
    children: [
      {
        kind: "story" as const,
        id: "b1",
        title: "Branch one",
        children: [
          { kind: "task" as const, id: "c1", title: "Commit one" },
          { kind: "story" as const, id: "b1s", title: "Stacked on one" },
        ],
      },
    ],
  },
};

// A story-rooted doc names its project and epic by id and reconciles a single
// story's own subtree (the story plus its tasks — no stacked children).
const storyDoc = {
  project: "my-product",
  epic: "epic-a",
  story: {
    id: "b1",
    title: "Branch one",
    children: [{ kind: "task" as const, id: "c1", title: "Commit one" }],
  },
};

describe("parseApplyDoc — epic form", () => {
  it("accepts an epic-rooted doc with a project id reference", () => {
    expect(parseApplyDoc(epicDoc).ok).toBe(true);
  });

  it("rejects a non-kebab project reference", () => {
    const result = parseApplyDoc({ ...epicDoc, project: "Not A Slug" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("kebab-case");
  });

  it("detects a duplicate id within the epic subtree", () => {
    const result = parseApplyDoc({
      project: "my-product",
      epic: {
        id: "dupe",
        title: "E",
        children: [{ kind: "story", id: "dupe", title: "clash" }],
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('duplicate id "dupe"');
  });
});

describe("parseApplyDoc — story form", () => {
  it("accepts a story-rooted doc with project + epic id references", () => {
    expect(parseApplyDoc(storyDoc).ok).toBe(true);
  });

  it("rejects a kind: story child on a story-rooted doc", () => {
    const result = parseApplyDoc({
      ...storyDoc,
      story: {
        ...storyDoc.story,
        children: [
          { kind: "task", id: "c1", title: "Commit one" },
          { kind: "story", id: "x", title: "X" },
        ],
      },
    });
    expect(result.ok).toBe(false);
  });

  it("detects a duplicate id between the story and one of its tasks", () => {
    const result = parseApplyDoc({
      project: "my-product",
      epic: "epic-a",
      story: {
        id: "b",
        title: "B",
        children: [{ kind: "task", id: "b", title: "collides with story" }],
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('duplicate id "b"');
  });
});

describe("flattenApplyDoc — epic form", () => {
  const result = parseApplyDoc(epicDoc);
  if (!result.ok) throw new Error(`epic doc should parse: ${result.message}`);
  const map = byId(flattenApplyDoc(result.doc));

  it("does not emit a project node (the project is a reference)", () => {
    expect(map.has("my-product")).toBe(false);
  });

  it("roots the epic under the referenced project", () => {
    const epic = map.get("epic-a");
    expect(epic?.kind).toBe("epic");
    expect(epic && "partOf" in epic && epic.partOf).toBe("my-product");
  });

  it("still infers containment and the fork point below the epic", () => {
    const story = map.get("b1");
    const commit = map.get("c1");
    const stacked = map.get("b1s");
    if (story?.kind !== "story" || stacked?.kind !== "story") {
      throw new Error("missing story");
    }
    expect(story.partOf).toBe("epic-a");
    expect(commit && "partOf" in commit && commit.partOf).toBe("b1");
    expect(stacked.partOf).toBe("epic-a");
    expect(stacked.stackedOn).toBe("b1");
  });
});

describe("flattenApplyDoc — story form", () => {
  const result = parseApplyDoc(storyDoc);
  if (!result.ok) throw new Error(`story doc should parse: ${result.message}`);
  const map = byId(flattenApplyDoc(result.doc));

  it("emits only the story and its tasks", () => {
    expect(map.has("my-product")).toBe(false);
    expect(map.has("epic-a")).toBe(false);
    expect([...map.keys()].sort()).toEqual(["b1", "c1"]);
  });

  it("roots the story under the referenced epic without a fork point", () => {
    const story = map.get("b1");
    if (story?.kind !== "story") throw new Error("missing story");
    expect(story.partOf).toBe("epic-a");
    // stackedOn is preserved from disk by apply, never emitted from the doc.
    expect(story.stackedOn).toBeUndefined();
  });
});

// Project-level Story as a Project `children:` entry (kind: story) with the
// same nested children shape as an epic-nested story.
const projectStoryChildDoc = {
  project: {
    id: "my-project",
    title: "My Project",
    children: [
      {
        kind: "story" as const,
        id: "solo",
        title: "Solo story",
        description: "Project-level.",
        children: [
          { kind: "task" as const, id: "solo-t1", title: "Task one" },
          { kind: "story" as const, id: "solo-stacked", title: "Stacked on solo" },
        ],
      },
      { kind: "idea" as const, id: "later", title: "Later" },
      {
        kind: "epic" as const,
        id: "epic-a",
        title: "Epic A",
        children: [{ kind: "story" as const, id: "epic-story", title: "Under epic" }],
      },
    ],
  },
};

// Story-rooted form without `epic:` — Story's partOf is the Project.
const projectStoryRootDoc = {
  project: "my-project",
  story: {
    id: "solo",
    title: "Solo story",
    children: [{ kind: "task" as const, id: "solo-t1", title: "Task one" }],
  },
};

describe("parseApplyDoc — project-level story child", () => {
  it("accepts kind: story under project children:", () => {
    expect(parseApplyDoc(projectStoryChildDoc).ok).toBe(true);
  });

  it("detects a duplicate id across a project-level story and a sibling", () => {
    const result = parseApplyDoc({
      project: {
        id: "p",
        title: "P",
        children: [
          { kind: "story", id: "dupe", title: "S" },
          { kind: "idea", id: "dupe", title: "I" },
        ],
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('duplicate id "dupe"');
  });
});

describe("flattenApplyDoc — project-level story child", () => {
  const result = parseApplyDoc(projectStoryChildDoc);
  if (!result.ok) {
    throw new Error(`project story child doc should parse: ${result.message}`);
  }
  const map = byId(flattenApplyDoc(result.doc));

  it("infers partOf as the Project for the story and its stacked child", () => {
    const solo = map.get("solo");
    const stacked = map.get("solo-stacked");
    if (solo?.kind !== "story" || stacked?.kind !== "story") {
      throw new Error("missing story");
    }
    expect(solo.partOf).toBe("my-project");
    expect(solo.order).toBe(0);
    expect(stacked.partOf).toBe("my-project");
    expect(stacked.stackedOn).toBe("solo");
    expect(map.get("solo-t1")).toMatchObject({ kind: "task", partOf: "solo" });
  });

  it("keeps epic-nested stories partOf the Epic", () => {
    expect(map.get("epic-story")).toMatchObject({
      kind: "story",
      partOf: "epic-a",
    });
  });

  it("interleaves story/idea/epic order from children index", () => {
    expect(map.get("solo")?.order).toBe(0);
    expect(map.get("later")?.order).toBe(1);
    expect(map.get("epic-a")?.order).toBe(2);
  });
});

describe("parseApplyDoc — project-level story form", () => {
  it("accepts project + story without epic:", () => {
    expect(parseApplyDoc(projectStoryRootDoc).ok).toBe(true);
  });

  it("still accepts the epic-scoped story form", () => {
    expect(parseApplyDoc(storyDoc).ok).toBe(true);
  });

  it("refuses kind: story under project-level story form", () => {
    const result = parseApplyDoc({
      project: "my-project",
      story: {
        id: "solo",
        title: "Solo",
        children: [{ kind: "story", id: "nested", title: "Nested" }],
      },
    });
    expect(result.ok).toBe(false);
  });
});

describe("flattenApplyDoc — project-level story form", () => {
  const result = parseApplyDoc(projectStoryRootDoc);
  if (!result.ok) {
    throw new Error(`project story root doc should parse: ${result.message}`);
  }
  const map = byId(flattenApplyDoc(result.doc));

  it("emits only the story and its tasks under the project", () => {
    expect(map.has("my-project")).toBe(false);
    expect([...map.keys()].sort()).toEqual(["solo", "solo-t1"]);
    const story = map.get("solo");
    if (story?.kind !== "story") throw new Error("missing story");
    expect(story.partOf).toBe("my-project");
    expect(story.stackedOn).toBeUndefined();
  });
});
