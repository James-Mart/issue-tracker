import { describe, expect, it } from "vitest";
import {
  isPersonaDraftReady,
  newPersonaDraft,
  normalizePersona,
  personaDraftsFromIssue,
  personasEqual,
  personasFromDraftsPreservingIncomplete,
  planPersonasSave,
} from "./personas";

const planner = {
  name: "Planner",
  description: "Plans work",
};

describe("persona drafts", () => {
  it("maps issue entries to drafts", () => {
    expect(personaDraftsFromIssue([planner])).toEqual([
      {
        key: "Planner",
        name: "Planner",
        description: "Plans work",
      },
    ]);
    expect(personaDraftsFromIssue(undefined)).toEqual([]);
  });

  it("creates empty drafts with unique keys", () => {
    const a = newPersonaDraft();
    const b = newPersonaDraft();
    expect(a).toMatchObject({ name: "", description: "" });
    expect(a.key.startsWith("new-")).toBe(true);
    expect(a.key).not.toBe(b.key);
  });

  it("normalizes trimmed fields", () => {
    expect(
      normalizePersona({
        key: "k",
        name: "  Planner  ",
        description: "  Plans work  ",
      }),
    ).toEqual(planner);
  });

  it("compares lists treating undefined as empty", () => {
    expect(personasEqual(undefined, [])).toBe(true);
    expect(personasEqual([planner], [planner])).toBe(true);
    expect(personasEqual([planner], [{ ...planner, name: "Other" }])).toBe(
      false,
    );
  });
});

describe("personasFromDraftsPreservingIncomplete", () => {
  it("skips incomplete new rows", () => {
    expect(
      personasFromDraftsPreservingIncomplete(
        [
          {
            key: "Planner",
            name: "Planner",
            description: "Plans work",
          },
          { key: "new-1", name: "", description: "" },
        ],
        [planner],
      ),
    ).toEqual([planner]);
  });

  it("keeps persisted entry when an existing row is incomplete", () => {
    expect(
      personasFromDraftsPreservingIncomplete(
        [{ key: "Planner", name: "", description: "mid-edit" }],
        [planner],
      ),
    ).toEqual([planner]);
  });

  it("preserves persisted personas whose name starts with new-", () => {
    const namedNew = {
      name: "new-role",
      description: "Role",
    };
    expect(
      personasFromDraftsPreservingIncomplete(
        [{ key: "new-role", name: "", description: "mid-edit" }],
        [namedNew],
      ),
    ).toEqual([namedNew]);
  });

  it("includes ready new and edited rows", () => {
    expect(
      personasFromDraftsPreservingIncomplete(
        [
          {
            key: "Planner",
            name: "Planner",
            description: "Updated",
          },
          {
            key: "new-1",
            name: "Implementor",
            description: "Writes code",
          },
        ],
        [planner],
      ),
    ).toEqual([
      { name: "Planner", description: "Updated" },
      { name: "Implementor", description: "Writes code" },
    ]);
  });

  it("reports readiness from name only", () => {
    expect(
      isPersonaDraftReady({
        key: "k",
        name: "Planner",
        description: "",
      }),
    ).toBe(true);
    expect(
      isPersonaDraftReady({
        key: "k",
        name: "",
        description: "Plans work",
      }),
    ).toBe(false);
  });
});

describe("planPersonasSave", () => {
  it("returns null when unchanged (ignoring blank new rows)", () => {
    expect(
      planPersonasSave(
        [planner],
        [
          ...personaDraftsFromIssue([planner]),
          { key: "new-1", name: "", description: "" },
        ],
      ),
    ).toEqual({ ok: true, personas: null });
  });

  it("returns normalized personas when changed", () => {
    expect(
      planPersonasSave(undefined, [
        {
          key: "new-1",
          name: "  Planner ",
          description: " Plans work ",
        },
      ]),
    ).toEqual({ ok: true, personas: [planner] });
  });

  it("surfaces schema validation errors for ready drafts", () => {
    const result = planPersonasSave(undefined, [
      {
        key: "1",
        name: "Planner",
        description: "a",
      },
      {
        key: "2",
        name: "Planner",
        description: "b",
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/duplicate persona name/i);
    }
  });

  it("allows remove while a blank new row is present", () => {
    expect(
      planPersonasSave(
        [planner, { name: "Implementor", description: "Writes code" }],
        [
          {
            key: "Implementor",
            name: "Implementor",
            description: "Writes code",
          },
          { key: "new-1", name: "", description: "" },
        ],
      ),
    ).toEqual({
      ok: true,
      personas: [{ name: "Implementor", description: "Writes code" }],
    });
  });
});
