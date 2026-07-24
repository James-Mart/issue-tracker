import { describe, expect, it } from "vitest";
import type { IssueDetail } from "@server/schemas";
import { blockedByFormValue, projectMetaValue } from "./issue-detail-form";

const branch: IssueDetail = {
  id: "auth-endpoints",
  kind: "story",
  title: "Auth endpoints",
  partOf: "add-auth",
  branchName: "feat/auth",
  merged: false,
  needsAttention: false,
  attentionReason: null,
  archived: false,
  order: 0,
  createdAt: "2026-07-09T14:35:00.000Z",
  updatedAt: "2026-07-09T15:00:00.000Z",
  description: "",
  version: "v1",
};

const epic: IssueDetail = {
  id: "add-auth",
  kind: "epic",
  title: "Add authentication",
  partOf: "platform",
  blockedBy: ["billing", "identity"],
  needsAttention: false,
  attentionReason: null,
  archived: false,
  order: 0,
  createdAt: "2026-07-09T14:00:00.000Z",
  updatedAt: "2026-07-09T14:00:00.000Z",
  description: "",
  version: "v1",
};

const project: Extract<IssueDetail, { kind: "project" }> = {
  id: "platform",
  kind: "project",
  title: "Platform",
  workspace: "/tmp/repo",
  mergePolicy: "pull-request",
  order: 0,
  createdAt: "2026-07-09T14:00:00.000Z",
  updatedAt: "2026-07-09T14:00:00.000Z",
  description: "",
  version: "v1",
};

describe("blockedByFormValue", () => {
  it("returns empty for a branch (no blockedBy field)", () => {
    expect(blockedByFormValue(branch)).toBe("");
  });

  it("joins an epic's blockedBy ids", () => {
    expect(blockedByFormValue(epic)).toBe("billing identity");
  });
});

describe("projectMetaValue", () => {
  it("returns mono workspace path when set", () => {
    expect(projectMetaValue(project, "workspace")).toEqual({
      text: "/tmp/repo",
      mono: true,
    });
  });

  it("returns muted empty state when workspace is unset", () => {
    const unset = { ...project, workspace: undefined };
    expect(projectMetaValue(unset, "workspace")).toEqual({
      text: "not set",
      muted: true,
    });
  });

  it("returns the merge policy display label", () => {
    expect(projectMetaValue(project, "mergePolicy")).toEqual({
      text: "Pull request",
    });
  });
});
