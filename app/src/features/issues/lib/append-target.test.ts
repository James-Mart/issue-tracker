import { describe, expect, it } from "vitest";
import type { IssueRecord } from "@server/schemas";
import { issuesById } from "./build-tree";
import {
  APPEND_TARGET_MERGED,
  APPEND_TARGET_NOT_FOUND,
  appendTargetCommitError,
  appendTargetWrongKindReason,
  savedAppendTargetState,
} from "./append-target";

const t0 = "2026-08-10T12:00:00.000Z";

const project: IssueRecord = {
  kind: "project",
  id: "platform",
  title: "Platform",
  mergePolicy: "manual",
  order: 0,
  createdAt: t0,
  updatedAt: t0,
};

const otherProject: IssueRecord = {
  kind: "project",
  id: "other",
  title: "Other",
  mergePolicy: "manual",
  order: 1,
  createdAt: t0,
  updatedAt: t0,
};

const epic: IssueRecord = {
  kind: "epic",
  id: "auth-epic",
  title: "Auth",
  partOf: "platform",
  order: 0,
  archived: false,
  needsAttention: false,
  createdAt: t0,
  updatedAt: t0,
};

const openStory: IssueRecord = {
  kind: "story",
  id: "open-story",
  title: "Open story",
  partOf: "auth-epic",
  order: 0,
  archived: false,
  needsAttention: false,
  createdAt: t0,
  updatedAt: t0,
  merged: false,
};

const mergedStory: IssueRecord = {
  kind: "story",
  id: "merged-story",
  title: "Merged story",
  partOf: "auth-epic",
  order: 1,
  archived: false,
  needsAttention: false,
  createdAt: t0,
  updatedAt: t0,
  merged: true,
};

const foreignStory: IssueRecord = {
  kind: "story",
  id: "foreign-story",
  title: "Foreign",
  partOf: "other",
  order: 0,
  archived: false,
  needsAttention: false,
  createdAt: t0,
  updatedAt: t0,
  merged: false,
};

const byId = issuesById([
  project,
  otherProject,
  epic,
  openStory,
  mergedStory,
  foreignStory,
]);

describe("appendTargetCommitError", () => {
  it("accepts an empty draft", () => {
    expect(appendTargetCommitError("   ", "platform", byId)).toBeNull();
  });

  it("accepts an open Story in this Project", () => {
    expect(
      appendTargetCommitError("open-story", "platform", byId),
    ).toBeNull();
  });

  it("refuses an id naming nothing in this Project", () => {
    expect(appendTargetCommitError("ghost", "platform", byId)).toBe(
      APPEND_TARGET_NOT_FOUND,
    );
    expect(appendTargetCommitError("foreign-story", "platform", byId)).toBe(
      APPEND_TARGET_NOT_FOUND,
    );
  });

  it("refuses an id naming an Epic", () => {
    expect(appendTargetCommitError("auth-epic", "platform", byId)).toBe(
      appendTargetWrongKindReason("epic"),
    );
    expect(appendTargetWrongKindReason("epic")).toBe(
      "Append targets must be Stories — this id names an Epic.",
    );
  });

  it("refuses a merged Story", () => {
    expect(appendTargetCommitError("merged-story", "platform", byId)).toBe(
      APPEND_TARGET_MERGED,
    );
  });
});

describe("savedAppendTargetState", () => {
  it("returns none when appendTo is unset", () => {
    expect(savedAppendTargetState(undefined, "platform", byId)).toEqual({
      kind: "none",
    });
  });

  it("returns valid with the Story title for an open target", () => {
    expect(savedAppendTargetState("open-story", "platform", byId)).toEqual({
      kind: "valid",
      storyTitle: "Open story",
    });
  });

  it("returns merged with the Story title for a landed target", () => {
    expect(savedAppendTargetState("merged-story", "platform", byId)).toEqual({
      kind: "merged",
      storyTitle: "Merged story",
    });
  });

  it("returns invalid for ids outside this Project or wrong kind", () => {
    expect(savedAppendTargetState("ghost", "platform", byId)).toEqual({
      kind: "invalid",
    });
    expect(savedAppendTargetState("foreign-story", "platform", byId)).toEqual({
      kind: "invalid",
    });
    expect(savedAppendTargetState("auth-epic", "platform", byId)).toEqual({
      kind: "invalid",
    });
  });
});
