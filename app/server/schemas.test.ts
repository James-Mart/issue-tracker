import { describe, expect, it } from "vitest";
import { parseChatMessage, parseChatMessageInput, parseIssue } from "./schemas";

const project = {
  id: "platform",
  kind: "project",
  title: "Platform",
  createdAt: "2026-07-09T14:00:00.000Z",
  updatedAt: "2026-07-09T14:00:00.000Z",
};

const epic = {
  id: "add-auth",
  kind: "epic",
  title: "Add authentication",
  partOf: "platform",
  createdAt: "2026-07-09T14:00:00.000Z",
  updatedAt: "2026-07-09T14:00:00.000Z",
};

const idea = {
  id: "capture-flow",
  kind: "idea",
  title: "Capture flow",
  partOf: "platform",
  createdAt: "2026-07-09T14:00:00.000Z",
  updatedAt: "2026-07-09T14:00:00.000Z",
};

const branch = {
  id: "auth-endpoints",
  kind: "story",
  title: "Auth endpoints",
  partOf: "add-auth",
  branchName: "feat/auth",
  stackedOn: "db-schema",
  merged: false,
  createdAt: "2026-07-09T14:35:00.000Z",
  updatedAt: "2026-07-09T15:00:00.000Z",
};

const commit = {
  id: "login-route",
  kind: "task",
  title: "Add login route",
  partOf: "auth-endpoints",
  status: "in-progress",
  createdAt: "2026-07-09T14:36:00.000Z",
  updatedAt: "2026-07-09T14:50:00.000Z",
};

describe("parseIssue - valid per kind", () => {
  it("parses a project with an optional workspace", () => {
    const result = parseIssue({ ...project, workspace: "/tmp/repo" });
    expect(result.ok).toBe(true);
    if (result.ok && result.issue.kind === "project") {
      expect(result.issue.workspace).toBe("/tmp/repo");
    }
  });

  it("defaults mergePolicy to manual for a project", () => {
    const result = parseIssue(project);
    expect(result.ok).toBe(true);
    if (result.ok && result.issue.kind === "project") {
      expect(result.issue.mergePolicy).toBe("manual");
    }
  });

  it("rejects an unknown mergePolicy", () => {
    expect(parseIssue({ ...project, mergePolicy: "rebase" }).ok).toBe(false);
  });

  it("parses optional supportingDocs refs", () => {
    const result = parseIssue({
      ...project,
      supportingDocs: {
        vision: { type: "attachment", name: "vision.md" },
        codingStandards: { type: "workspace", path: "docs/cs.md" },
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.issue.kind === "project") {
      expect(result.issue.supportingDocs).toEqual({
        vision: { type: "attachment", name: "vision.md" },
        codingStandards: { type: "workspace", path: "docs/cs.md" },
      });
    }
  });

  it("rejects unknown supportingDocs keys and bad refs", () => {
    expect(
      parseIssue({
        ...project,
        supportingDocs: {
          vision: { type: "attachment", name: "vision.md" },
          extra: { type: "attachment", name: "x.md" },
        },
      }).ok,
    ).toBe(false);
    expect(
      parseIssue({
        ...project,
        supportingDocs: { vision: { type: "attachment" } },
      }).ok,
    ).toBe(false);
    expect(
      parseIssue({
        ...project,
        supportingDocs: { vision: { type: "workspace", path: "" } },
      }).ok,
    ).toBe(false);
  });

  it("parses optional inspirationApps entries", () => {
    const result = parseIssue({
      ...project,
      inspirationApps: [
        {
          name: "Notion",
          url: "https://notion.so",
          description: "Notes",
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.issue.kind === "project") {
      expect(result.issue.inspirationApps).toEqual([
        {
          name: "Notion",
          url: "https://notion.so",
          description: "Notes",
        },
      ]);
    }
  });

  it("rejects bad inspirationApps entries", () => {
    expect(
      parseIssue({
        ...project,
        inspirationApps: [{ name: "", url: "https://x", description: "x" }],
      }).ok,
    ).toBe(false);
    expect(
      parseIssue({
        ...project,
        inspirationApps: [
          { name: "X", url: "https://x", description: "x", extra: true },
        ],
      }).ok,
    ).toBe(false);
    expect(
      parseIssue({
        ...project,
        inspirationApps: [
          { name: "Notion", url: "https://a", description: "a" },
          { name: "Notion", url: "https://b", description: "b" },
        ],
      }).ok,
    ).toBe(false);
  });

  it("parses a project (minimal fields only)", () => {
    const result = parseIssue(project);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.issue.kind).toBe("project");
  });

  it("parses an epic and defaults blockedBy to []", () => {
    const result = parseIssue(epic);
    expect(result.ok).toBe(true);
    if (result.ok && result.issue.kind === "epic") {
      expect(result.issue.blockedBy).toEqual([]);
    }
  });

  it("parses an epic with an optional retro", () => {
    const inProgress = parseIssue({ ...epic, retro: "in-progress" });
    expect(inProgress.ok).toBe(true);
    if (inProgress.ok && inProgress.issue.kind === "epic") {
      expect(inProgress.issue.retro).toBe("in-progress");
    }

    const done = parseIssue({ ...epic, retro: "done" });
    expect(done.ok).toBe(true);
    if (done.ok && done.issue.kind === "epic") {
      expect(done.issue.retro).toBe("done");
    }

    const absent = parseIssue(epic);
    expect(absent.ok).toBe(true);
    if (absent.ok && absent.issue.kind === "epic") {
      expect(absent.issue.retro).toBeUndefined();
    }
  });

  it("rejects an unknown retro value", () => {
    expect(parseIssue({ ...epic, retro: "pending" }).ok).toBe(false);
  });

  it("rejects an epic missing its partOf project", () => {
    const { partOf: _partOf, ...rest } = epic;
    expect(parseIssue(rest).ok).toBe(false);
  });

  it("parses a branch with its stackedOn fork point and no blockedBy", () => {
    const result = parseIssue(branch);
    expect(result.ok).toBe(true);
    if (result.ok && result.issue.kind === "story") {
      expect(result.issue.stackedOn).toBe("db-schema");
      expect("blockedBy" in result.issue).toBe(false);
    }
  });

  it("strips a legacy stored mergeBase on a branch (derived-only)", () => {
    const withBase = parseIssue({ ...branch, mergeBase: "main" });
    expect(withBase.ok).toBe(true);
    if (withBase.ok && withBase.issue.kind === "story") {
      expect("mergeBase" in withBase.issue).toBe(false);
    }
    const absent = parseIssue(branch);
    expect(absent.ok).toBe(true);
    if (absent.ok && absent.issue.kind === "story") {
      expect("mergeBase" in absent.issue).toBe(false);
    }
  });

  it("parses a branch with an optional specReview", () => {
    const passed = parseIssue({ ...branch, specReview: "passed" });
    expect(passed.ok).toBe(true);
    if (passed.ok && passed.issue.kind === "story") {
      expect(passed.issue.specReview).toBe("passed");
    }

    const failed = parseIssue({ ...branch, specReview: "failed" });
    expect(failed.ok).toBe(true);
    if (failed.ok && failed.issue.kind === "story") {
      expect(failed.issue.specReview).toBe("failed");
    }

    const absent = parseIssue(branch);
    expect(absent.ok).toBe(true);
    if (absent.ok && absent.issue.kind === "story") {
      expect(absent.issue.specReview).toBeUndefined();
    }
  });

  it("rejects an unknown specReview value", () => {
    expect(parseIssue({ ...branch, specReview: "pending" }).ok).toBe(false);
  });

  it("parses a branch with an optional retro", () => {
    const inProgress = parseIssue({ ...branch, retro: "in-progress" });
    expect(inProgress.ok).toBe(true);
    if (inProgress.ok && inProgress.issue.kind === "story") {
      expect(inProgress.issue.retro).toBe("in-progress");
    }

    const done = parseIssue({ ...branch, retro: "done" });
    expect(done.ok).toBe(true);
    if (done.ok && done.issue.kind === "story") {
      expect(done.issue.retro).toBe("done");
    }

    const absent = parseIssue(branch);
    expect(absent.ok).toBe(true);
    if (absent.ok && absent.issue.kind === "story") {
      expect(absent.issue.retro).toBeUndefined();
    }
  });

  it("rejects an unknown retro value on a story", () => {
    expect(parseIssue({ ...branch, retro: "pending" }).ok).toBe(false);
  });

  it("parses a commit with a stored status", () => {
    const result = parseIssue(commit);
    expect(result.ok).toBe(true);
    if (result.ok && result.issue.kind === "task") {
      expect(result.issue.status).toBe("in-progress");
    }

    const fixing = parseIssue({ ...commit, status: "fixing" });
    expect(fixing.ok).toBe(true);
    if (fixing.ok && fixing.issue.kind === "task") {
      expect(fixing.issue.status).toBe("fixing");
    }
  });

  it("parses a commit with an optional qa", () => {
    const reviewing = parseIssue({ ...commit, qa: "reviewing" });
    expect(reviewing.ok).toBe(true);
    if (reviewing.ok && reviewing.issue.kind === "task") {
      expect(reviewing.issue.qa).toBe("reviewing");
    }

    const changesRequested = parseIssue({ ...commit, qa: "changes-requested" });
    expect(changesRequested.ok).toBe(true);
    if (changesRequested.ok && changesRequested.issue.kind === "task") {
      expect(changesRequested.issue.qa).toBe("changes-requested");
    }

    const passed = parseIssue({ ...commit, qa: "passed" });
    expect(passed.ok).toBe(true);
    if (passed.ok && passed.issue.kind === "task") {
      expect(passed.issue.qa).toBe("passed");
    }

    const absent = parseIssue(commit);
    expect(absent.ok).toBe(true);
    if (absent.ok && absent.issue.kind === "task") {
      expect(absent.issue.qa).toBeUndefined();
    }
  });

  it("rejects an unknown qa value", () => {
    expect(parseIssue({ ...commit, qa: "pending" }).ok).toBe(false);
  });

  it("rejects an unknown task status value", () => {
    expect(parseIssue({ ...commit, status: "reviewing" }).ok).toBe(false);
  });

  it("parses a commit with an optional noDiff", () => {
    const withNoDiff = parseIssue({ ...commit, noDiff: true });
    expect(withNoDiff.ok).toBe(true);
    if (withNoDiff.ok && withNoDiff.issue.kind === "task") {
      expect(withNoDiff.issue.noDiff).toBe(true);
    }

    const absent = parseIssue(commit);
    expect(absent.ok).toBe(true);
    if (absent.ok && absent.issue.kind === "task") {
      expect(absent.issue.noDiff).toBeUndefined();
    }
  });

  it("rejects a non-boolean noDiff value", () => {
    expect(parseIssue({ ...commit, noDiff: "yes" }).ok).toBe(false);
  });

  it("defaults needsAttention/attentionReason", () => {
    const result = parseIssue(epic);
    if (result.ok && result.issue.kind === "epic") {
      expect(result.issue.needsAttention).toBe(false);
      expect(result.issue.attentionReason).toBeNull();
    }
  });

  it("defaults archived to false when absent on epic/idea/branch/commit", () => {
    for (const raw of [epic, idea, branch, commit]) {
      const result = parseIssue(raw);
      expect(result.ok).toBe(true);
      if (result.ok && "archived" in result.issue) {
        expect(result.issue.archived).toBe(false);
      }
    }
  });

  it("strips archived on a project (field is epic/idea/branch/commit only)", () => {
    const result = parseIssue({ ...project, archived: true });
    expect(result.ok).toBe(true);
    if (result.ok) expect("archived" in result.issue).toBe(false);
  });

  it("parses an idea with partOf and no assignee/attention fields", () => {
    const result = parseIssue(idea);
    expect(result.ok).toBe(true);
    if (result.ok && result.issue.kind === "idea") {
      expect(result.issue.partOf).toBe("platform");
      expect("assignee" in result.issue).toBe(false);
      expect("needsAttention" in result.issue).toBe(false);
      expect("attentionReason" in result.issue).toBe(false);
    }
  });

  it("parses epic and story without assignee", () => {
    for (const raw of [epic, branch]) {
      const result = parseIssue(raw);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect("assignee" in result.issue).toBe(false);
      }
    }
  });

  it("strips assignee on epic and story", () => {
    for (const raw of [epic, branch]) {
      const result = parseIssue({ ...raw, assignee: "bot" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect("assignee" in result.issue).toBe(false);
      }
    }
  });

  it("rejects an idea missing its partOf project", () => {
    const { partOf: _partOf, ...rest } = idea;
    expect(parseIssue(rest).ok).toBe(false);
  });

  it("parses a project catalog label with valid color", () => {
    const result = parseIssue({
      ...project,
      labels: [{ id: "bug", color: "#ff0000", description: "Defects" }],
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.issue.kind === "project") {
      expect(result.issue.labels).toEqual([
        { id: "bug", color: "#ff0000", description: "Defects" },
      ]);
    }
  });

  it("rejects an invalid catalog color", () => {
    expect(
      parseIssue({
        ...project,
        labels: [{ id: "bug", color: "#fff" }],
      }).ok,
    ).toBe(false);
    expect(
      parseIssue({
        ...project,
        labels: [{ id: "bug", color: "red" }],
      }).ok,
    ).toBe(false);
  });

  it("rejects a catalog description longer than 120 characters", () => {
    expect(
      parseIssue({
        ...project,
        labels: [{ id: "bug", color: "#00ff00", description: "x".repeat(121) }],
      }).ok,
    ).toBe(false);
  });

  it("accepts a catalog description of exactly 120 characters", () => {
    const result = parseIssue({
      ...project,
      labels: [{ id: "bug", color: "#00ff00", description: "x".repeat(120) }],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a non-kebab catalog id", () => {
    expect(
      parseIssue({
        ...project,
        labels: [{ id: "Bug Label", color: "#00ff00" }],
      }).ok,
    ).toBe(false);
  });

  it("dedupes assignment labels while preserving order", () => {
    const result = parseIssue({
      ...epic,
      labels: ["bug", "feat", "bug", "chore"],
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.issue.kind === "epic") {
      expect(result.issue.labels).toEqual(["bug", "feat", "chore"]);
    }
  });

  it("parses idea and story assignment labels", () => {
    const ideaResult = parseIssue({ ...idea, labels: ["bug"] });
    expect(ideaResult.ok).toBe(true);
    if (ideaResult.ok && ideaResult.issue.kind === "idea") {
      expect(ideaResult.issue.labels).toEqual(["bug"]);
    }
    const storyResult = parseIssue({ ...branch, labels: ["feat"] });
    expect(storyResult.ok).toBe(true);
    if (storyResult.ok && storyResult.issue.kind === "story") {
      expect(storyResult.issue.labels).toEqual(["feat"]);
    }
  });
});

describe("parseIssue - malformed is rejected with a message", () => {
  it("rejects an unknown kind", () => {
    const result = parseIssue({ ...epic, kind: "milestone" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message.length).toBeGreaterThan(0);
  });

  it("rejects a missing title", () => {
    const { title: _title, ...rest } = epic;
    const result = parseIssue(rest);
    expect(result.ok).toBe(false);
  });

  it("rejects an empty title", () => {
    expect(parseIssue({ ...epic, title: "" }).ok).toBe(false);
  });

  it("rejects a non-object", () => {
    expect(parseIssue(null).ok).toBe(false);
    expect(parseIssue("nope").ok).toBe(false);
  });

  it("rejects a wrong-typed field", () => {
    expect(parseIssue({ ...commit, status: 3 }).ok).toBe(false);
  });
});

describe("parseChatMessage", () => {
  const valid = { role: "agent", body: "hello", at: "2026-07-09T14:00:00.000Z" };

  it("parses a stored message with an optional name", () => {
    const result = parseChatMessage({ ...valid, name: "codex" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message.name).toBe("codex");
  });

  it("rejects an empty body, a missing at, and a non-object", () => {
    expect(parseChatMessage({ ...valid, body: "" }).ok).toBe(false);
    const { at: _at, ...noAt } = valid;
    expect(parseChatMessage(noAt).ok).toBe(false);
    expect(parseChatMessage(null).ok).toBe(false);
  });
});

describe("parseChatMessageInput", () => {
  it("accepts role + body (+ optional name) and omits at", () => {
    const result = parseChatMessageInput({ role: "human", body: "hi" });
    expect(result.ok).toBe(true);
    if (result.ok) expect("at" in result.input).toBe(false);
  });

  it("rejects a missing role, an empty body, and a null/undefined body", () => {
    expect(parseChatMessageInput({ body: "hi" }).ok).toBe(false);
    expect(parseChatMessageInput({ role: "agent", body: "" }).ok).toBe(false);
    expect(parseChatMessageInput(null).ok).toBe(false);
    expect(parseChatMessageInput(undefined).ok).toBe(false);
  });
});
