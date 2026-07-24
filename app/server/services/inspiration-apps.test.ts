import { describe, expect, it } from "vitest";
import type { Issue } from "../schemas.js";
import {
  formatInspirationAppsLine,
  validateInspirationAppsPatch,
} from "./inspiration-apps.js";

const AT = "2026-07-09T14:00:00.000Z";

function project(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "p",
    kind: "project",
    title: "P",
    mergePolicy: "manual",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  } as Issue;
}

describe("inspirationApps validation", () => {
  it("accepts valid entries", () => {
    expect(() =>
      validateInspirationAppsPatch(project(), {
        inspirationApps: [
          {
            name: "Notion",
            url: "https://notion.so",
            description: "Note-taking app",
          },
        ],
      }),
    ).not.toThrow();
  });

  it("refuses non-project kinds", () => {
    expect(() =>
      validateInspirationAppsPatch(
        {
          id: "e",
          kind: "epic",
          title: "E",
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
          inspirationApps: [
            {
              name: "Notion",
              url: "https://notion.so",
              description: "Note-taking app",
            },
          ],
        },
      ),
    ).toThrow(/only valid on a project/);
  });

  it("refuses empty name or url", () => {
    expect(() =>
      validateInspirationAppsPatch(project(), {
        inspirationApps: [{ name: "", url: "https://x", description: "x" }],
      }),
    ).toThrow(/Too small/);
    expect(() =>
      validateInspirationAppsPatch(project(), {
        inspirationApps: [{ name: "X", url: "", description: "x" }],
      }),
    ).toThrow(/Too small/);
  });

  it("refuses duplicate names", () => {
    expect(() =>
      validateInspirationAppsPatch(project(), {
        inspirationApps: [
          { name: "Notion", url: "https://a", description: "a" },
          { name: "Notion", url: "https://b", description: "b" },
        ],
      }),
    ).toThrow(/duplicate inspiration app name/);
  });
});

describe("inspirationApps helpers", () => {
  it("formats a compact view/summary line", () => {
    expect(
      formatInspirationAppsLine([
        {
          name: "Notion",
          url: "https://notion.so",
          description: "Notes",
        },
        {
          name: "Figma",
          url: "https://figma.com",
          description: "Design",
        },
      ]),
    ).toBe(
      "Notion — https://notion.so — Notes, Figma — https://figma.com — Design",
    );
  });
});
