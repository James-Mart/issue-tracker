import { describe, expect, it } from "vitest";
import { personasFromDraftsPreservingIncomplete } from "./personas";

const planner = {
  name: "Planner",
  description: "Plans work",
};

describe("personasFromDraftsPreservingIncomplete", () => {
  it("keeps persisted entry when an existing row is incomplete", () => {
    expect(
      personasFromDraftsPreservingIncomplete(
        [{ key: "Planner", name: "", description: "mid-edit" }],
        [planner],
      ),
    ).toEqual([planner]);
  });
});
