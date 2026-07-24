import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  coerceSetPatch,
  resolveInspirationAppsSet,
  resolveLabelCatalogSet,
  resolveSupportingDocsSet,
} from "./cli-kind.js";

describe("coerceSetPatch", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it.each([
    {
      name: "string title",
      kind: "project" as const,
      field: "title",
      value: "Hello",
      opts: {},
      patch: { title: "Hello" },
    },
    {
      name: "enum mergePolicy",
      kind: "project" as const,
      field: "mergePolicy",
      value: "pull-request",
      opts: {},
      patch: { mergePolicy: "pull-request" },
    },
    {
      name: "clearable workspace via --clear",
      kind: "project" as const,
      field: "workspace",
      value: undefined,
      opts: { clear: true },
      patch: { workspace: null },
    },
    {
      name: "description positional",
      kind: "project" as const,
      field: "description",
      value: "body\n",
      opts: {},
      patch: { description: "body\n" },
    },
    {
      name: "boolean true",
      kind: "story" as const,
      field: "merged",
      value: "true",
      opts: {},
      patch: { merged: true },
    },
    {
      name: "boolean false",
      kind: "task" as const,
      field: "noDiff",
      value: "false",
      opts: {},
      patch: { noDiff: false },
    },
    {
      name: "commitSha",
      kind: "task" as const,
      field: "commitSha",
      value: "0123456789abcdef0123456789abcdef01234567",
      opts: {},
      patch: { commitSha: "0123456789abcdef0123456789abcdef01234567" },
    },
    {
      name: "array full replace",
      kind: "epic" as const,
      field: "blockedBy",
      value: '["a","b"]',
      opts: {},
      patch: { blockedBy: ["a", "b"] },
    },
    {
      name: "array --clear empties",
      kind: "epic" as const,
      field: "blockedBy",
      value: undefined,
      opts: { clear: true },
      patch: { blockedBy: [] },
    },
    {
      name: "needsAttention true with --reason",
      kind: "epic" as const,
      field: "needsAttention",
      value: "true",
      opts: { reason: "blocked on design" },
      patch: { needsAttention: true, attentionReason: "blocked on design" },
    },
    {
      name: "needsAttention false clears reason",
      kind: "epic" as const,
      field: "needsAttention",
      value: "false",
      opts: {},
      patch: { needsAttention: false, attentionReason: null },
    },
    {
      name: "needsAttention --clear matches attention --clear",
      kind: "epic" as const,
      field: "needsAttention",
      value: undefined,
      opts: { clear: true },
      patch: { needsAttention: false, attentionReason: null },
    },
  ])("$name", ({ kind, field, value, opts, patch }) => {
    expect(coerceSetPatch(kind, field, value, opts)).toEqual(patch);
  });

  it("unions --add into current blockedBy", () => {
    expect(
      coerceSetPatch("epic", "blockedBy", undefined, { add: ["b", "a"] }, ["a"]),
    ).toEqual({ blockedBy: ["a", "b"] });
  });

  it("drops --remove from current blockedBy", () => {
    expect(
      coerceSetPatch(
        "epic",
        "blockedBy",
        undefined,
        { remove: ["b"] },
        ["a", "b", "c"],
      ),
    ).toEqual({ blockedBy: ["a", "c"] });
  });

  it("reads description from --file", () => {
    dir = mkdtempSync(join(tmpdir(), "cli-kind-"));
    const path = join(dir, "d.md");
    writeFileSync(path, "from file\n");
    expect(
      coerceSetPatch("project", "description", undefined, { file: path }),
    ).toEqual({ description: "from file\n" });
  });

  it.each([
    {
      name: "unknown field",
      kind: "project" as const,
      field: "assignee",
      value: "x",
      opts: {},
      error: /unknown or unsettable field "assignee"/,
    },
    {
      name: "unknown field on epic",
      kind: "epic" as const,
      field: "assignee",
      value: "x",
      opts: {},
      error: /unknown or unsettable field "assignee"/,
    },
    {
      name: "unknown field on story",
      kind: "story" as const,
      field: "assignee",
      value: "x",
      opts: {},
      error: /unknown or unsettable field "assignee"/,
    },
    {
      name: "invalid enum",
      kind: "project" as const,
      field: "mergePolicy",
      value: "nope",
      opts: {},
      error: /invalid mergePolicy "nope"/,
    },
    {
      name: "invalid boolean",
      kind: "task" as const,
      field: "noDiff",
      value: "maybe",
      opts: {},
      error: /invalid noDiff "maybe"/,
    },
    {
      name: "invalid commitSha",
      kind: "task" as const,
      field: "commitSha",
      value: "4019c25",
      opts: {},
      error: /invalid commit sha/,
    },
    {
      name: "invalid array json",
      kind: "epic" as const,
      field: "blockedBy",
      value: "[",
      opts: {},
      error: /invalid blockedBy JSON/,
    },
    {
      name: "non-string array json",
      kind: "epic" as const,
      field: "blockedBy",
      value: "[1,2]",
      opts: {},
      error: /expected a JSON array of strings/,
    },
    {
      name: "non-clearable --clear",
      kind: "project" as const,
      field: "title",
      value: undefined,
      opts: { clear: true },
      error: /field "title" cannot be cleared/,
    },
    {
      name: "--clear with value",
      kind: "project" as const,
      field: "workspace",
      value: "/tmp",
      opts: { clear: true },
      error: /--clear cannot be combined/,
    },
    {
      name: "--file with positional value",
      kind: "project" as const,
      field: "description",
      value: "inline",
      opts: { file: "/dev/null" },
      error: /--file cannot be combined with a positional value/,
    },
    {
      name: "needsAttention true without --reason",
      kind: "epic" as const,
      field: "needsAttention",
      value: "true",
      opts: {},
      error: /provide --reason/,
    },
    {
      name: "missing value",
      kind: "project" as const,
      field: "title",
      value: undefined,
      opts: {},
      error: /provide a value for title/,
    },
    {
      name: "--add on non-array field",
      kind: "project" as const,
      field: "title",
      value: undefined,
      opts: { add: ["x"] },
      error: /only valid for array fields/,
    },
    {
      name: "array value with --add",
      kind: "epic" as const,
      field: "blockedBy",
      value: '["a"]',
      opts: { add: ["b"] },
      error: /mutually exclusive/,
    },
    {
      name: "array missing mode",
      kind: "epic" as const,
      field: "blockedBy",
      value: undefined,
      opts: {},
      error: /provide a JSON array value, --file, --add, --remove, or --clear/,
    },
  ])("rejects $name", ({ kind, field, value, opts, error }) => {
    expect(() => coerceSetPatch(kind, field, value, opts)).toThrow(error);
  });
});

describe("resolveLabelCatalogSet", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("upserts a catalog entry via --add", () => {
    expect(
      resolveLabelCatalogSet(
        undefined,
        { add: [JSON.stringify({ id: "bug", color: "#ff0000" })] },
        [{ id: "feat", color: "#00ff00" }],
      ),
    ).toEqual({
      action: "patch",
      patch: {
        labels: [
          { id: "feat", color: "#00ff00" },
          { id: "bug", color: "#ff0000" },
        ],
      },
    });
  });

  it("updates an existing catalog entry by id", () => {
    expect(
      resolveLabelCatalogSet(
        undefined,
        { add: [JSON.stringify({ id: "bug", color: "#aa0000" })] },
        [{ id: "bug", color: "#ff0000" }],
      ),
    ).toEqual({
      action: "patch",
      patch: { labels: [{ id: "bug", color: "#aa0000" }] },
    });
  });

  it("removes and clears catalog entries", () => {
    expect(
      resolveLabelCatalogSet(
        undefined,
        { remove: ["bug"] },
        [
          { id: "bug", color: "#ff0000" },
          { id: "feat", color: "#00ff00" },
        ],
      ),
    ).toEqual({
      action: "patch",
      patch: { labels: [{ id: "feat", color: "#00ff00" }] },
    });
    expect(
      resolveLabelCatalogSet(
        undefined,
        { clear: true },
        [{ id: "bug", color: "#ff0000" }],
      ),
    ).toEqual({ action: "patch", patch: { labels: [] } });
  });

  it("returns a rename action", () => {
    expect(
      resolveLabelCatalogSet(
        undefined,
        { rename: ["bug", "defect"] },
        [{ id: "bug", color: "#ff0000" }],
      ),
    ).toEqual({ action: "rename", oldId: "bug", newId: "defect" });
  });

  it("treats --add + --file as a single upsert mode", () => {
    dir = mkdtempSync(join(tmpdir(), "cli-kind-"));
    const path = join(dir, "label.json");
    writeFileSync(path, JSON.stringify({ id: "feat", color: "#00ff00" }));
    expect(
      resolveLabelCatalogSet(undefined, { add: [], file: path }, []),
    ).toEqual({
      action: "patch",
      patch: { labels: [{ id: "feat", color: "#00ff00" }] },
    });
  });
});

describe("resolveSupportingDocsSet", () => {
  it("sets an attachment or workspace ref for one doc key", () => {
    expect(
      resolveSupportingDocsSet(
        { doc: "vision", attachment: "vision.md" },
        undefined,
      ),
    ).toEqual({
      supportingDocs: {
        vision: { type: "attachment", name: "vision.md" },
      },
    });
    expect(
      resolveSupportingDocsSet(
        { doc: "codingStandards", workspace: "docs/cs.md" },
        { vision: { type: "attachment", name: "vision.md" } },
      ),
    ).toEqual({
      supportingDocs: {
        vision: { type: "attachment", name: "vision.md" },
        codingStandards: { type: "workspace", path: "docs/cs.md" },
      },
    });
  });

  it("clears one key or the whole field", () => {
    expect(
      resolveSupportingDocsSet(
        { clear: true, doc: "vision" },
        {
          vision: { type: "attachment", name: "vision.md" },
          designSystem: { type: "workspace", path: "ds.md" },
        },
      ),
    ).toEqual({
      supportingDocs: {
        designSystem: { type: "workspace", path: "ds.md" },
      },
    });
    expect(
      resolveSupportingDocsSet(
        { clear: true, doc: "vision" },
        { vision: { type: "attachment", name: "vision.md" } },
      ),
    ).toEqual({ supportingDocs: null });
    expect(resolveSupportingDocsSet({ clear: true }, undefined)).toEqual({
      supportingDocs: null,
    });
  });

  it("rejects unknown keys and invalid mode combos", () => {
    expect(() =>
      resolveSupportingDocsSet({ doc: "roadmap", attachment: "x.md" }, undefined),
    ).toThrow(/unknown supportingDocs key/);
    expect(() =>
      resolveSupportingDocsSet(
        { doc: "vision", attachment: "a.md", workspace: "b.md" },
        undefined,
      ),
    ).toThrow(/exactly one/);
    expect(() => resolveSupportingDocsSet({}, undefined)).toThrow(/--doc/);
  });
});

describe("resolveInspirationAppsSet", () => {
  const notion = {
    name: "Notion",
    url: "https://notion.so",
    description: "Notes",
  };
  const figma = {
    name: "Figma",
    url: "https://figma.com",
    description: "Design",
  };

  it("adds and upserts entries", () => {
    expect(
      resolveInspirationAppsSet(undefined, { add: [JSON.stringify(notion)] }, []),
    ).toEqual({ inspirationApps: [notion] });
    expect(
      resolveInspirationAppsSet(
        undefined,
        {
          add: [
            JSON.stringify({
              ...notion,
              description: "Updated",
            }),
          ],
        },
        [notion],
      ),
    ).toEqual({
      inspirationApps: [{ ...notion, description: "Updated" }],
    });
    expect(
      resolveInspirationAppsSet(
        undefined,
        { add: [JSON.stringify(figma)] },
        [notion],
      ),
    ).toEqual({ inspirationApps: [notion, figma] });
  });

  it("removes by name and clears all", () => {
    expect(
      resolveInspirationAppsSet(undefined, { remove: ["Notion"] }, [notion, figma]),
    ).toEqual({ inspirationApps: [figma] });
    expect(resolveInspirationAppsSet(undefined, { clear: true }, [notion])).toEqual({
      inspirationApps: [],
    });
  });

  it("replaces the full array from a positional value", () => {
    expect(
      resolveInspirationAppsSet(JSON.stringify([notion, figma]), {}, []),
    ).toEqual({ inspirationApps: [notion, figma] });
  });

  it("rejects invalid modes and payloads", () => {
    expect(() =>
      resolveInspirationAppsSet(undefined, { add: ["{}", "{}"] }, []),
    ).toThrow(/single JSON object/);
    expect(() =>
      resolveInspirationAppsSet(undefined, { add: [JSON.stringify({ name: "" })] }, []),
    ).toThrow(/invalid inspirationApps/);
    expect(() =>
      resolveInspirationAppsSet(undefined, { clear: true, remove: ["X"] }, []),
    ).toThrow(/mutually exclusive/);
    expect(() =>
      resolveInspirationAppsSet(
        JSON.stringify([
          { name: "A", url: "https://a", description: "a" },
          { name: "A", url: "https://b", description: "b" },
        ]),
        {},
        [],
      ),
    ).toThrow(/duplicate inspiration app name/);
  });
});
