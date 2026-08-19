import { describe, expect, it } from "vitest";
import {
  assertStoryCanSetMergeBase,
  assertStoryCanSetSourceIdea,
  MERGE_BASE_SET_ERROR,
  SOURCE_IDEA_SET_ERROR,
} from "./kind-fields.js";

describe("assertStoryCanSetMergeBase", () => {
  it("allows a project-level root Story", () => {
    expect(() => assertStoryCanSetMergeBase({}, "project")).not.toThrow();
  });

  it("rejects a first-layer Epic Story", () => {
    expect(() => assertStoryCanSetMergeBase({}, "epic")).toThrow(
      MERGE_BASE_SET_ERROR,
    );
  });

  it("rejects a stacked Story", () => {
    expect(() =>
      assertStoryCanSetMergeBase({ stackedOn: "a" }, "project"),
    ).toThrow(MERGE_BASE_SET_ERROR);
    expect(() =>
      assertStoryCanSetMergeBase({ stackedOn: "a" }, "epic"),
    ).toThrow(MERGE_BASE_SET_ERROR);
  });
});

describe("assertStoryCanSetSourceIdea", () => {
  it("allows a project-level root Story", () => {
    expect(() => assertStoryCanSetSourceIdea({}, "project")).not.toThrow();
  });

  it("rejects a first-layer Epic Story", () => {
    expect(() => assertStoryCanSetSourceIdea({}, "epic")).toThrow(
      SOURCE_IDEA_SET_ERROR,
    );
  });

  it("rejects a stacked Story", () => {
    expect(() =>
      assertStoryCanSetSourceIdea({ stackedOn: "a" }, "project"),
    ).toThrow(SOURCE_IDEA_SET_ERROR);
    expect(() =>
      assertStoryCanSetSourceIdea({ stackedOn: "a" }, "epic"),
    ).toThrow(SOURCE_IDEA_SET_ERROR);
  });
});
