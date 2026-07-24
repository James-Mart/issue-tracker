import { describe, expect, it } from "vitest";
import {
  assertStoryCanSetMergeBase,
  MERGE_BASE_SET_ERROR,
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
