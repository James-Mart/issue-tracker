import { describe, expect, it } from "vitest";
import {
  inspirationAppDraftsFromIssue,
  inspirationAppsEqual,
  inspirationAppsFromDraftsPreservingIncomplete,
  isInspirationAppDraftReady,
  newInspirationAppDraft,
  normalizeInspirationApp,
  planInspirationAppsSave,
} from "./inspiration-apps";

const notion = {
  name: "Notion",
  url: "https://notion.so",
  description: "Notes",
};

describe("inspiration app drafts", () => {
  it("maps issue entries to drafts", () => {
    expect(inspirationAppDraftsFromIssue([notion])).toEqual([
      {
        key: "Notion",
        name: "Notion",
        url: "https://notion.so",
        description: "Notes",
      },
    ]);
    expect(inspirationAppDraftsFromIssue(undefined)).toEqual([]);
  });

  it("creates empty drafts with unique keys", () => {
    const a = newInspirationAppDraft();
    const b = newInspirationAppDraft();
    expect(a).toMatchObject({ name: "", url: "", description: "" });
    expect(a.key.startsWith("new-")).toBe(true);
    expect(a.key).not.toBe(b.key);
  });

  it("normalizes trimmed fields", () => {
    expect(
      normalizeInspirationApp({
        key: "k",
        name: "  Notion  ",
        url: "  https://notion.so  ",
        description: "  Notes  ",
      }),
    ).toEqual(notion);
  });

  it("compares lists treating undefined as empty", () => {
    expect(inspirationAppsEqual(undefined, [])).toBe(true);
    expect(inspirationAppsEqual([notion], [notion])).toBe(true);
    expect(
      inspirationAppsEqual([notion], [{ ...notion, name: "Other" }]),
    ).toBe(false);
  });
});

describe("inspirationAppsFromDraftsPreservingIncomplete", () => {
  it("skips incomplete new rows", () => {
    expect(
      inspirationAppsFromDraftsPreservingIncomplete(
        [
          {
            key: "Notion",
            name: "Notion",
            url: "https://notion.so",
            description: "Notes",
          },
          { key: "new-1", name: "", url: "", description: "" },
        ],
        [notion],
      ),
    ).toEqual([notion]);
  });

  it("keeps persisted entry when an existing row is incomplete", () => {
    expect(
      inspirationAppsFromDraftsPreservingIncomplete(
        [
          {
            key: "Notion",
            name: "",
            url: "https://notion.so",
            description: "mid-edit",
          },
        ],
        [notion],
      ),
    ).toEqual([notion]);
  });

  it("preserves persisted apps whose name starts with new-", () => {
    const namedNew = {
      name: "new-tool",
      url: "https://example.com",
      description: "Tool",
    };
    expect(
      inspirationAppsFromDraftsPreservingIncomplete(
        [
          {
            key: "new-tool",
            name: "",
            url: "https://example.com",
            description: "mid-edit",
          },
        ],
        [namedNew],
      ),
    ).toEqual([namedNew]);
  });

  it("includes ready new and edited rows", () => {
    expect(
      inspirationAppsFromDraftsPreservingIncomplete(
        [
          {
            key: "Notion",
            name: "Notion",
            url: "https://notion.so",
            description: "Updated",
          },
          {
            key: "new-1",
            name: "Figma",
            url: "https://figma.com",
            description: "Design",
          },
        ],
        [notion],
      ),
    ).toEqual([
      { name: "Notion", url: "https://notion.so", description: "Updated" },
      { name: "Figma", url: "https://figma.com", description: "Design" },
    ]);
  });

  it("reports readiness from name and url", () => {
    expect(
      isInspirationAppDraftReady({
        key: "k",
        name: "X",
        url: "https://x",
        description: "",
      }),
    ).toBe(true);
    expect(
      isInspirationAppDraftReady({
        key: "k",
        name: "",
        url: "https://x",
        description: "x",
      }),
    ).toBe(false);
  });
});

describe("planInspirationAppsSave", () => {
  it("returns null when unchanged (ignoring blank new rows)", () => {
    expect(
      planInspirationAppsSave(
        [notion],
        [
          ...inspirationAppDraftsFromIssue([notion]),
          { key: "new-1", name: "", url: "", description: "" },
        ],
      ),
    ).toEqual({ ok: true, apps: null });
  });

  it("returns normalized apps when changed", () => {
    expect(
      planInspirationAppsSave(undefined, [
        {
          key: "new-1",
          name: "  Notion ",
          url: " https://notion.so ",
          description: " Notes ",
        },
      ]),
    ).toEqual({ ok: true, apps: [notion] });
  });

  it("surfaces schema validation errors for ready drafts", () => {
    const result = planInspirationAppsSave(undefined, [
      {
        key: "1",
        name: "Notion",
        url: "https://notion.so",
        description: "a",
      },
      {
        key: "2",
        name: "Notion",
        url: "https://other",
        description: "b",
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/duplicate inspiration app name/i);
    }
  });

  it("allows remove while a blank new row is present", () => {
    expect(
      planInspirationAppsSave(
        [notion, { name: "Figma", url: "https://figma.com", description: "D" }],
        [
          {
            key: "Figma",
            name: "Figma",
            url: "https://figma.com",
            description: "D",
          },
          { key: "new-1", name: "", url: "", description: "" },
        ],
      ),
    ).toEqual({
      ok: true,
      apps: [{ name: "Figma", url: "https://figma.com", description: "D" }],
    });
  });
});
