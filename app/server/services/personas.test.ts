import { describe, expect, it } from "vitest";
import type { Issue } from "../schemas.js";
import { formatPersonasLine, validatePersonasPatch } from "./personas.js";

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

describe("personas validation", () => {
  it("accepts valid entries", () => {
    expect(() =>
      validatePersonasPatch(project(), {
        personas: [{ name: "Planner", description: "Plans work" }],
      }),
    ).not.toThrow();
  });

  it("refuses non-project kinds", () => {
    expect(() =>
      validatePersonasPatch(
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
          personas: [{ name: "Planner", description: "Plans work" }],
        },
      ),
    ).toThrow(/only valid on a project/);
  });

  it("refuses empty name", () => {
    expect(() =>
      validatePersonasPatch(project(), {
        personas: [{ name: "", description: "x" }],
      }),
    ).toThrow(/Too small/);
  });

  it("refuses duplicate names", () => {
    expect(() =>
      validatePersonasPatch(project(), {
        personas: [
          { name: "Planner", description: "a" },
          { name: "Planner", description: "b" },
        ],
      }),
    ).toThrow(/duplicate persona name/);
  });
});

describe("personas helpers", () => {
  it("formats a compact view/summary line", () => {
    expect(
      formatPersonasLine([
        { name: "Planner", description: "Plans work" },
        { name: "Implementor", description: "Writes code" },
      ]),
    ).toBe("Planner — Plans work, Implementor — Writes code");
  });
});
